use super::transport::{Transport, call, embed, inspect};
use super::*;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

pub(crate) struct Script {
    pub calls: Mutex<Vec<(String, Option<Value>)>>,
    pub responses: Mutex<VecDeque<Result<Value>>>,
}
impl Script {
    pub fn new(responses: Vec<Result<Value>>) -> Arc<Self> {
        Arc::new(Self {
            calls: Mutex::new(Vec::new()),
            responses: Mutex::new(responses.into()),
        })
    }
}
impl Transport for Script {
    fn request<'a>(
        &'a self,
        _: &'a str,
        route: &'a str,
        body: Option<Value>,
        _: &'a CancelFlag,
    ) -> Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push((route.to_owned(), body));
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Err(SemanticFailure::Unreachable))
        })
    }
}
pub(crate) fn tags(digest: &str) -> Value {
    json!({"models":[{"name":"embed:latest","digest":digest}]})
}
pub(crate) fn show() -> Value {
    json!({"capabilities":["embedding"],"model_info":{"test.embedding_length":2}})
}
pub(crate) fn vector() -> Value {
    json!({"model":"embed:latest","embeddings":[[3.0,4.0]]})
}

#[test]
fn endpoint_has_no_remote_dns_path_credentials_or_ambient_proxy_authority() {
    assert_eq!(
        endpoint("http://localhost:11434/").unwrap(),
        "http://127.0.0.1:11434"
    );
    assert!(endpoint("http://[::1]:11434").is_ok());
    for denied in [
        "https://localhost:11434",
        "http://private.invalid:11434",
        "http://192.168.1.1",
        "http://169.254.169.254",
        "http://127.0.0.1/api/embed",
        "http://x:secret@127.0.0.1",
        "http://localhost/?key=secret",
        "http://localhost/#x",
        "http://localhost\\evil",
        "http://localhost.:",
    ] {
        assert_eq!(
            endpoint(denied),
            Err(SemanticFailure::EndpointDenied),
            "{denied}"
        );
    }
}
#[test]
fn clipping_and_fingerprint_use_full_unambiguous_identity_input() {
    let profile = Id::new("profile").unwrap();
    let bookmark = Id::new("bookmark").unwrap();
    let epoch = SourceEpoch::new(1).unwrap();
    let long = "😀".repeat(9000);
    let (text, clipped) = input(&long, "summary");
    assert!(clipped);
    assert!(text.chars().count() <= 8192 && text.len() <= 32768);
    assert_ne!(
        fingerprint(&profile, epoch, &bookmark, "a\nb", "c"),
        fingerprint(&profile, epoch, &bookmark, "a", "b\nc")
    );
    assert_ne!(
        fingerprint(&profile, epoch, &bookmark, &long, "a"),
        fingerprint(&profile, epoch, &bookmark, &long, "b")
    );
    assert_ne!(
        fingerprint(&profile, epoch, &bookmark, "a", "b"),
        fingerprint(&profile, SourceEpoch::new(2).unwrap(), &bookmark, "a", "b")
    );
}
#[test]
fn little_endian_vectors_are_finite_unit_and_dimension_bounded() {
    let normalized = normalize(vec![3., 4.]).unwrap();
    assert_eq!(encode(&normalized)[..4], 0.6_f32.to_le_bytes());
    assert_eq!(decode(&encode(&normalized), 2).unwrap(), normalized);
    for values in [
        vec![],
        vec![0., 0.],
        vec![f32::NAN],
        vec![f32::INFINITY],
        vec![1.; 4097],
    ] {
        assert_eq!(normalize(values), Err(SemanticFailure::InvalidVector));
    }
    assert_eq!(
        decode(&encode(&[0.016; 4096]), 4096),
        Err(SemanticFailure::InvalidVector)
    );
    assert_eq!(decode(&[0; 7], 2), Err(SemanticFailure::InvalidVector));
    assert!(
        normalize(vec![f32::MAX, f32::MAX])
            .unwrap()
            .iter()
            .all(|v| v.is_finite())
    );
}
#[tokio::test]
async fn metadata_cloud_missing_and_wrong_model_never_send_bookmark_text() {
    let digest = "a".repeat(64);
    for remote in [
        json!({"remote_model":"secret-cloud"}),
        json!({"model_info":{"remote_host":"https://cloud.invalid"}}),
    ] {
        let mut metadata = show();
        for (key, value) in remote.as_object().unwrap() {
            metadata[key] = value.clone();
        }
        let mock = Script::new(vec![Ok(tags(&digest)), Ok(metadata)]);
        assert_eq!(
            inspect(
                mock.as_ref(),
                "http://localhost:11434",
                "embed",
                &CancelFlag::new()
            )
            .await,
            Err(SemanticFailure::RemoteModel)
        );
        assert!(
            mock.calls
                .lock()
                .unwrap()
                .iter()
                .all(|(route, body)| route != "embed"
                    && !body.as_ref().is_some_and(|b| b.get("input").is_some()))
        );
    }
    let mock = Script::new(vec![Ok(json!({"models":[]}))]);
    assert_eq!(
        inspect(
            mock.as_ref(),
            "http://localhost:11434",
            "embed",
            &CancelFlag::new()
        )
        .await,
        Err(SemanticFailure::MissingModel)
    );
    for response in [
        json!({"embeddings":[[1.,0.]]}),
        json!({"model":"other","embeddings":[[1.,0.]]}),
    ] {
        let mock = Script::new(vec![Ok(response)]);
        assert_eq!(
            embed(
                mock.as_ref(),
                "http://localhost:11434",
                "embed:latest",
                "synthetic".into(),
                &CancelFlag::new()
            )
            .await,
            Err(SemanticFailure::ModelChanged)
        );
    }
}
struct Pending;
impl Transport for Pending {
    fn request<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
        _: Option<Value>,
        _: &'a CancelFlag,
    ) -> Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>> {
        Box::pin(std::future::pending())
    }
}
#[tokio::test(start_paused = true)]
async fn cancellation_before_subscribe_and_total_timeout_are_durable() {
    let flag = CancelFlag::new();
    flag.cancel();
    assert_eq!(
        call(&Pending, "http://localhost", "tags", None, &flag).await,
        Err(SemanticFailure::Cancelled)
    );
    assert_eq!(
        call(
            &Pending,
            "http://localhost",
            "tags",
            None,
            &CancelFlag::new()
        )
        .await,
        Err(SemanticFailure::TimedOut)
    );
}

async fn http_fixture(response: Vec<u8>) -> (String, tokio::task::JoinHandle<()>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut bytes = Vec::new();
        let mut chunk = [0; 1024];
        while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            let n = socket.read(&mut chunk).await.unwrap();
            if n == 0 {
                break;
            }
            bytes.extend_from_slice(&chunk[..n]);
            assert!(bytes.len() < 8192);
        }
        let request = String::from_utf8(bytes).unwrap().to_ascii_lowercase();
        assert!(request.starts_with("get /api/tags "));
        assert!(!request.contains("authorization:") && !request.contains("cookie:"));
        let _ = socket.write_all(&response).await;
    });
    (format!("http://{address}"), task)
}
#[tokio::test]
async fn actual_http_adapter_denies_redirect_without_following_and_caps_streamed_body() {
    let destination = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let location = format!(
        "http://{}/must-not-contact",
        destination.local_addr().unwrap()
    );
    let (base,task)=http_fixture(format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_bytes()).await;
    let http = super::HttpTransport::new().unwrap();
    assert_eq!(
        call(&http, &base, "tags", None, &CancelFlag::new()).await,
        Err(SemanticFailure::EndpointDenied)
    );
    task.await.unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), destination.accept())
            .await
            .is_err()
    );
    let (base, task) = http_fixture(
        b"HTTP/1.1 200 OK\r\nContent-Length: 1048577\r\nConnection: close\r\n\r\n".to_vec(),
    )
    .await;
    assert_eq!(
        call(&http, &base, "tags", None, &CancelFlag::new()).await,
        Err(SemanticFailure::InvalidResponse)
    );
    task.await.unwrap();
    let body = vec![b' '; 1_048_577];
    let mut response = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
    response.extend_from_slice(&body);
    let (base, task) = http_fixture(response).await;
    assert_eq!(
        call(&http, &base, "tags", None, &CancelFlag::new()).await,
        Err(SemanticFailure::InvalidResponse)
    );
    task.await.unwrap();
}

#[tokio::test]
async fn digest_accepts_one_optional_sha256_prefix_and_rejects_repeated_prefix() {
    for digest in ["a".repeat(64), format!("sha256:{}", "a".repeat(64))] {
        let mock = Script::new(vec![Ok(tags(&digest)), Ok(show())]);
        assert_eq!(
            inspect(
                mock.as_ref(),
                "http://localhost:11434",
                "embed",
                &CancelFlag::new()
            )
            .await
            .unwrap()
            .digest,
            "a".repeat(64)
        );
    }
    let mock = Script::new(vec![Ok(tags(&format!("sha256:sha256:{}", "a".repeat(64))))]);
    assert_eq!(
        inspect(
            mock.as_ref(),
            "http://localhost:11434",
            "embed",
            &CancelFlag::new()
        )
        .await,
        Err(SemanticFailure::InvalidResponse)
    );
    assert_eq!(mock.calls.lock().unwrap().len(), 1);
}
