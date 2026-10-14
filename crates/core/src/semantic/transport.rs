use super::{CancelFlag, Result, SemanticFailure, endpoint, model, normalize};
use futures_util::StreamExt;
use serde_json::{Value, json};
use std::{future::Future, pin::Pin, time::Duration};

pub(crate) trait Transport: Send + Sync {
    fn request<'a>(
        &'a self,
        endpoint: &'a str,
        route: &'a str,
        body: Option<Value>,
        cancel: &'a CancelFlag,
    ) -> Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>>;
}
pub(crate) struct HttpTransport {
    client: reqwest::Client,
}
impl HttpTransport {
    pub(crate) fn new() -> std::result::Result<Self, markbridge_protocol::ErrorCode> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| markbridge_protocol::ErrorCode::StorageError)?;
        Ok(Self { client })
    }
}
impl Transport for HttpTransport {
    fn request<'a>(
        &'a self,
        base: &'a str,
        route: &'a str,
        body: Option<Value>,
        cancel: &'a CancelFlag,
    ) -> Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>> {
        Box::pin(async move {
            let base = endpoint(base)?;
            if !matches!(route, "tags" | "show" | "embed") {
                return Err(SemanticFailure::EndpointDenied);
            }
            let url = format!("{base}/api/{route}");
            let request = match body {
                Some(body) => self.client.post(url).json(&body),
                None => self.client.get(url),
            };
            let response = request.send().await.map_err(|error| {
                if error.is_timeout() {
                    SemanticFailure::TimedOut
                } else {
                    SemanticFailure::Unreachable
                }
            })?;
            if response.status().is_redirection() {
                return Err(SemanticFailure::EndpointDenied);
            }
            if !response.status().is_success() {
                return Err(SemanticFailure::MissingModel);
            }
            if response
                .content_length()
                .is_some_and(|size| size > 1_048_576)
            {
                return Err(SemanticFailure::InvalidResponse);
            }
            let mut stream = response.bytes_stream();
            let mut bytes = Vec::new();
            while let Some(chunk) = stream.next().await {
                if cancel.is_cancelled() {
                    return Err(SemanticFailure::Cancelled);
                }
                let chunk = chunk.map_err(|_| SemanticFailure::Unreachable)?;
                if bytes.len().saturating_add(chunk.len()) > 1_048_576 {
                    return Err(SemanticFailure::InvalidResponse);
                }
                bytes.extend_from_slice(&chunk);
            }
            serde_json::from_slice(&bytes).map_err(|_| SemanticFailure::InvalidResponse)
        })
    }
}
pub(crate) async fn call(
    transport: &dyn Transport,
    base: &str,
    route: &str,
    body: Option<Value>,
    cancel: &CancelFlag,
) -> Result<Value> {
    if cancel.is_cancelled() {
        return Err(SemanticFailure::Cancelled);
    }
    tokio::select! { biased;
        _ = cancel.cancelled() => Err(SemanticFailure::Cancelled),
        result = tokio::time::timeout(Duration::from_secs(15), transport.request(base,route,body,cancel)) => result.unwrap_or(Err(SemanticFailure::TimedOut)),
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ModelInfo {
    pub model: String,
    pub digest: String,
    pub dimension: Option<u16>,
}
pub(crate) async fn inspect(
    transport: &dyn Transport,
    base: &str,
    name: &str,
    cancel: &CancelFlag,
) -> Result<ModelInfo> {
    let base = endpoint(base)?;
    let name = model(name)?;
    let tags = call(transport, &base, "tags", None, cancel).await?;
    let models = tags
        .get("models")
        .and_then(Value::as_array)
        .ok_or(SemanticFailure::InvalidResponse)?;
    let matches: Vec<_> = models
        .iter()
        .filter(|m| {
            m.get("name").and_then(Value::as_str).is_some_and(|actual| {
                actual == name || (actual == format!("{name}:latest") && !name.contains(':'))
            })
        })
        .collect();
    if matches.len() != 1 {
        return Err(SemanticFailure::MissingModel);
    }
    let tag = matches[0];
    reject_remote(tag)?;
    let actual = model(
        tag["name"]
            .as_str()
            .ok_or(SemanticFailure::InvalidResponse)?,
    )?;
    let digest = tag["digest"]
        .as_str()
        .ok_or(SemanticFailure::InvalidResponse)?
        .strip_prefix("sha256:")
        .unwrap_or(
            tag["digest"]
                .as_str()
                .ok_or(SemanticFailure::InvalidResponse)?,
        );
    if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(SemanticFailure::InvalidResponse);
    }
    let show = call(
        transport,
        &base,
        "show",
        Some(json!({"model":actual})),
        cancel,
    )
    .await?;
    reject_remote(&show)?;
    if !show
        .get("capabilities")
        .and_then(Value::as_array)
        .is_some_and(|c| c.iter().any(|v| v.as_str() == Some("embedding")))
    {
        return Err(SemanticFailure::MissingModel);
    }
    let dimensions: Vec<_> = show
        .get("model_info")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|m| m.iter())
        .filter(|(key, _)| key.ends_with(".embedding_length"))
        .map(|(_, value)| value.as_u64())
        .collect();
    let dimension = match dimensions.as_slice() {
        [] => None,
        [Some(value)] if (1..=4096).contains(value) => Some(*value as u16),
        _ => return Err(SemanticFailure::DimensionMismatch),
    };
    Ok(ModelInfo {
        model: actual,
        digest: digest.to_ascii_lowercase(),
        dimension,
    })
}
fn reject_remote(value: &Value) -> Result<()> {
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                if matches!(key.as_str(), "remote_model" | "remote_host")
                    && !value.is_null()
                    && value.as_str() != Some("")
                {
                    return Err(SemanticFailure::RemoteModel);
                }
                reject_remote(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                reject_remote(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}
pub(crate) async fn embed(
    transport: &dyn Transport,
    base: &str,
    model: &str,
    text: String,
    cancel: &CancelFlag,
) -> Result<Vec<f32>> {
    let response = call(
        transport,
        base,
        "embed",
        Some(json!({"model":model,"input":[text],"truncate":false})),
        cancel,
    )
    .await?;
    if response.get("model").and_then(Value::as_str) != Some(model) {
        return Err(SemanticFailure::ModelChanged);
    }
    let rows = response
        .get("embeddings")
        .and_then(Value::as_array)
        .ok_or(SemanticFailure::InvalidVector)?;
    if rows.len() != 1 {
        return Err(SemanticFailure::InvalidVector);
    }
    let row = rows[0].as_array().ok_or(SemanticFailure::InvalidVector)?;
    if row.is_empty() || row.len() > 4096 {
        return Err(SemanticFailure::InvalidVector);
    }
    let values = row
        .iter()
        .map(|value| {
            value
                .as_f64()
                .map(|v| v as f32)
                .ok_or(SemanticFailure::InvalidVector)
        })
        .collect::<Result<Vec<_>>>()?;
    normalize(values)
}
