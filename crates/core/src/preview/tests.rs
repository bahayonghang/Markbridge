use std::{
    collections::{HashMap, VecDeque},
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use futures_util::future::BoxFuture;
use markbridge_protocol::{
    BookmarkNode, Counter, DisplayName, FolderType, Id, NodeKind, Position, PreviewFailure,
    PreviewStatus, SourceEpoch, SummarySource, Title, TreeSnapshot, Url,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

use crate::storage::{PairedOrigin, Profile, Storage};

use super::{
    Gate,
    extract::extract_html,
    fetch::{
        CancelFlag, FETCH_TIMEOUT, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, MAX_REDIRECTS, Network,
    },
    guard::{self, is_forbidden_ip},
    load_content_preview,
    service::MAX_CACHE_BYTES,
};

fn id(value: &str) -> Id {
    Id::new(value).unwrap()
}
fn count(value: u64) -> Counter {
    Counter::new(value).unwrap()
}
fn epoch(value: u64) -> SourceEpoch {
    SourceEpoch::new(value).unwrap()
}

fn profile(value: &str) -> Profile {
    Profile {
        id: id(value),
        instance_id: id(&format!("instance-{value}")),
        source_epoch: epoch(1),
        display_name: DisplayName::new(value).unwrap(),
        paired_origin: PairedOrigin::new("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            .unwrap(),
        credential_reference: None,
    }
}

fn node(chrome_id: &str, parent: Option<&str>, position: u64, url: Option<&str>) -> BookmarkNode {
    BookmarkNode {
        chrome_id: id(chrome_id),
        parent_id: parent.map(id),
        position: Position::new(position).unwrap(),
        kind: if url.is_some() {
            NodeKind::Bookmark
        } else {
            NodeKind::Folder
        },
        title: Title::new(format!("合成 {chrome_id}")).unwrap(),
        url: url.map(|value| Url::new(value).unwrap()),
        folder_type: None,
        unmodifiable: None,
        date_added: None,
        date_last_used: None,
    }
}

async fn storage_with(urls: &[(&str, &str)]) -> Storage {
    let directory = tempfile::tempdir().unwrap();
    let storage = Storage::open(directory.path().join("preview.sqlite"))
        .await
        .unwrap();
    std::mem::forget(directory);
    storage.create_profile(profile("profile-a")).await.unwrap();
    let mut nodes = vec![node("0", None, 0, None), node("1", Some("0"), 0, None)];
    nodes[1].folder_type = Some(FolderType::BookmarksBar);
    for (index, (chrome_id, url)) in urls.iter().enumerate() {
        nodes.push(node(chrome_id, Some("1"), index as u64, Some(url)));
    }
    storage
        .replace_tree(
            id("profile-a"),
            id("session-a"),
            TreeSnapshot {
                source_epoch: epoch(1),
                revision: count(1),
                barrier_seq: count(1),
                nodes,
            },
        )
        .await
        .unwrap();
    storage
}

fn gif() -> &'static [u8] {
    b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
}

fn respond(status: u16, extra: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 {status} X\r\nConnection: close\r\nContent-Length: {}\r\n{extra}\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

struct Fixture {
    net: FixtureNet,
    secret_hits: Arc<AtomicUsize>,
    _server: tokio::task::JoinHandle<()>,
}

struct FixtureNet {
    answers: Arc<Mutex<HashMap<String, VecDeque<Vec<IpAddr>>>>>,
    calls: Arc<Mutex<Vec<String>>>,
    routes: Arc<HashMap<SocketAddr, SocketAddr>>,
    dials: Arc<Mutex<Vec<SocketAddr>>>,
    refuse: Arc<AtomicBool>,
}

impl Network for FixtureNet {
    fn resolve(
        &self,
        host: String,
        _port: u16,
    ) -> BoxFuture<'static, Result<Vec<IpAddr>, PreviewFailure>> {
        let answers = self.answers.clone();
        let calls = self.calls.clone();
        Box::pin(async move {
            calls.lock().unwrap().push(host.clone());
            let mut answers = answers.lock().unwrap();
            let queue = answers.get_mut(&host).ok_or(PreviewFailure::Unreachable)?;
            if queue.len() > 1 {
                Ok(queue.pop_front().unwrap())
            } else {
                Ok(queue.front().cloned().unwrap_or_default())
            }
        })
    }
    fn connect(&self, addr: SocketAddr) -> BoxFuture<'static, Result<TcpStream, PreviewFailure>> {
        let routes = self.routes.clone();
        let dials = self.dials.clone();
        let refuse = self.refuse.clone();
        Box::pin(async move {
            dials.lock().unwrap().push(addr);
            if refuse.load(Ordering::SeqCst) {
                return Err(PreviewFailure::Unreachable);
            }
            let target = *routes.get(&addr).ok_or(PreviewFailure::Unreachable)?;
            TcpStream::connect(target)
                .await
                .map_err(|_| PreviewFailure::Unreachable)
        })
    }
}

async fn fixture(delay: Duration, rebind: bool) -> Fixture {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let local = listener.local_addr().unwrap();
    let secret_hits = Arc::new(AtomicUsize::new(0));
    let hits_task = Arc::new(AtomicUsize::new(0));
    let secret_task = secret_hits.clone();
    let server = tokio::spawn(async move {
        loop {
            let Ok((socket, _)) = listener.accept().await else {
                break;
            };
            let hits_task = hits_task.clone();
            let secret_task = secret_task.clone();
            tokio::spawn(async move {
                let _ = serve_socket(socket, delay, hits_task, secret_task).await;
            });
        }
    });
    let mut answers = HashMap::new();
    answers.insert(
        "allowed.test".into(),
        VecDeque::from([vec![IpAddr::V4(Ipv4Addr::new(203, 0, 113, 10))]]),
    );
    let rebind_answers = if rebind {
        vec![
            vec![IpAddr::V4(Ipv4Addr::new(203, 0, 113, 10))],
            vec![IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))],
        ]
    } else {
        vec![vec![IpAddr::V4(Ipv4Addr::new(203, 0, 113, 10))]]
    };
    answers.insert("rebind.test".into(), VecDeque::from(rebind_answers));
    answers.insert(
        "both.test".into(),
        VecDeque::from([vec![
            IpAddr::V4(Ipv4Addr::new(203, 0, 113, 10)),
            IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
        ]]),
    );
    let route = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(203, 0, 113, 10)), 80);
    Fixture {
        net: FixtureNet {
            answers: Arc::new(Mutex::new(answers)),
            calls: Arc::new(Mutex::new(Vec::new())),
            routes: Arc::new(HashMap::from([(route, local)])),
            dials: Arc::new(Mutex::new(Vec::new())),
            refuse: Arc::new(AtomicBool::new(false)),
        },
        secret_hits,
        _server: server,
    }
}

async fn serve_socket(
    mut socket: TcpStream,
    delay: Duration,
    hits: Arc<AtomicUsize>,
    secret: Arc<AtomicUsize>,
) -> std::io::Result<()> {
    let mut buf = vec![0u8; 8192];
    let n = tokio::time::timeout(Duration::from_secs(2), socket.read(&mut buf))
        .await
        .unwrap_or(Ok(0))?;
    let text = String::from_utf8_lossy(&buf[..n]);
    let path = text.split(' ').nth(1).unwrap_or("");
    let host = text
        .lines()
        .find_map(|line| {
            line.to_ascii_lowercase()
                .strip_prefix("host:")
                .map(|value| value.trim().to_owned())
        })
        .unwrap_or_default();
    hits.fetch_add(1, Ordering::SeqCst);
    if path.starts_with("/secret") {
        secret.fetch_add(1, Ordering::SeqCst);
    }
    if path == "/hang" {
        std::future::pending::<()>().await;
    }
    if !delay.is_zero() {
        tokio::time::sleep(delay).await;
    }
    let bytes = match (host.as_str(), path) {
        ("allowed.test", "/a") => respond(200, "Content-Type: text/html\r\n", "<!doctype html><html><head><title>Page A</title><meta name=\"description\" content=\"摘要 A\"><meta property=\"og:image\" content=\"http://allowed.test/a.gif\"></head><body><p>可见正文</p><script>secret()</script></body></html>".as_bytes()),
        ("allowed.test", "/b") => respond(200, "Content-Type: text/html\r\n", "<!doctype html><html><head><title>No Image</title><meta name=\"description\" content=\"只有文字\"></head><body><p>没有图片</p></body></html>".as_bytes()),
        ("allowed.test", "/c") => respond(200, "Content-Type: text/html\r\n", "<!doctype html><html><head><title>Local Image</title><meta name=\"description\" content=\"图被拒绝\"><meta property=\"og:image\" content=\"http://127.0.0.1/secret.gif\"></head><body><p>正文</p></body></html>".as_bytes()),
        ("allowed.test", "/a.gif") => respond(200, "Content-Type: image/gif\r\n", gif()),
        ("allowed.test", "/redirect") => respond(302, "Location: http://127.0.0.1/secret\r\n", b""),
        ("allowed.test", "/bomb") => respond(200, "Content-Type: text/html\r\nContent-Encoding: gzip\r\n", &gzip_bomb()),
        ("rebind.test", "/start") => respond(302, "Location: http://rebind.test/landed\r\n", b""),
        ("rebind.test", "/landed") => respond(200, "Content-Type: text/html\r\n", br#"<title>Landed</title><p>safe</p>"#),
        _ => respond(404, "Content-Type: text/plain\r\n", b"missing"),
    };
    socket.write_all(&bytes).await
}

fn gzip_bomb() -> Vec<u8> {
    use std::io::Write;
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    encoder
        .write_all(&vec![b'a'; MAX_DOCUMENT_BYTES + 1])
        .unwrap();
    encoder.finish().unwrap()
}

async fn load(
    storage: &Storage,
    chrome_id: &str,
    request: &str,
    flag: &CancelFlag,
    net: &dyn Network,
) -> markbridge_protocol::ContentPreview {
    load_content_preview(
        storage,
        id("profile-a"),
        id(chrome_id),
        id(request),
        flag,
        net,
    )
    .await
    .unwrap()
}

#[test]
fn budgets_match_the_parent_contract() {
    assert_eq!(FETCH_TIMEOUT, Duration::from_secs(10));
    assert_eq!(MAX_REDIRECTS, 5);
    assert_eq!(MAX_DOCUMENT_BYTES, 5 * 1024 * 1024);
    assert_eq!(MAX_IMAGE_BYTES, 2 * 1024 * 1024);
    assert_eq!(MAX_CACHE_BYTES, 200 * 1024 * 1024);
    assert_eq!(
        cache_time_label_for_test(0),
        "离线缓存 · 1970-01-01 00:00 UTC"
    );
}

#[test]
fn blocks_forbidden_targets_before_a_connection() {
    for url in [
        "file:///C:/Windows",
        "javascript:alert(1)",
        "data:text/html,hi",
        "http://127.0.0.1/secret",
        "http://127.1/",
        "http://2130706433/",
        "http://0177.0.0.1/",
        "http://0x7f000001/",
        "http://10.1.2.3/",
        "http://192.168.1.1/",
        "http://172.16.5.5/",
        "http://169.254.169.254/latest",
        "http://100.100.100.200/",
        "http://224.0.0.1/",
        "http://239.255.255.255/",
        "http://255.255.255.255/",
        "http://0.0.0.0/",
        "http://[::]/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[::ffff:169.254.169.254]/",
        "http://[::ffff:10.1.2.3]/",
        "http://[fd00:ec2::254]/",
        "http://[fe80::1]/",
        "http://[ff02::1]/",
        "http://localhost/",
        "http://metadata.google.internal/",
        "http://metadata.goog/",
        "http://user:pass@203.0.113.10/a",
    ] {
        assert!(guard::check_url(url).is_err(), "{url}");
    }
    assert!(guard::check_url("http://allowed.test/a").is_ok());
    assert!(guard::check_url("http://203.0.113.10/a").is_ok());
    assert!(is_forbidden_ip("127.0.0.1".parse().unwrap()));
    assert!(is_forbidden_ip("169.254.169.254".parse().unwrap()));
    assert!(!is_forbidden_ip("203.0.113.10".parse().unwrap()));
}

#[test]
fn extract_uses_description_or_excerpt_and_skips_script() {
    let described = extract_html(
        "<title>T</title><meta name=\"description\" content=\"说明\"><script>secret()</script><p>正文</p>",
    );
    assert_eq!(described.summary.as_deref(), Some("说明"));
    assert_eq!(described.summary_source, Some("description"));
    let excerpt = extract_html("<title>T</title><script>secret()</script><p>可见正文</p>");
    assert_eq!(excerpt.summary.as_deref(), Some("可见正文"));
    assert_eq!(excerpt.summary_source, Some("excerpt"));
    assert!(!excerpt.summary.unwrap().contains("secret"));
}

#[tokio::test]
async fn http_fixture_shows_text_image_and_empty_image() {
    let fx = fixture(Duration::ZERO, false).await;
    let storage = storage_with(&[
        ("10", "http://allowed.test/a"),
        ("11", "http://allowed.test/b"),
    ])
    .await;
    let page = load(&storage, "10", "pv-a", &CancelFlag::new(), &fx.net).await;
    assert_eq!(page.status, PreviewStatus::Ready);
    assert_eq!(page.title.0.as_deref(), Some("Page A"));
    assert_eq!(page.summary.0.as_deref(), Some("摘要 A"));
    assert_eq!(page.summary_source.0, Some(SummarySource::Description));
    let image = page.image.0.expect("source image");
    assert_eq!(image.media_type, markbridge_protocol::ImageMediaType::Gif);
    assert_eq!(image.source_label, "og:image");
    assert!(page.image_failure.0.is_none());
    assert!(page.failure.0.is_none());
    let empty = load(&storage, "11", "pv-b", &CancelFlag::new(), &fx.net).await;
    assert_eq!(empty.title.0.as_deref(), Some("No Image"));
    assert_eq!(empty.summary.0.as_deref(), Some("只有文字"));
    assert!(empty.image.0.is_none());
    assert!(empty.image_failure.0.is_none());
    assert!(empty.image_failure_message.0.is_none());
}

#[tokio::test]
async fn http_fixture_blocks_forbidden_redirect_image_rebind_and_expansion() {
    let fx = fixture(Duration::ZERO, true).await;
    let storage = storage_with(&[
        ("20", "http://127.0.0.1/secret"),
        ("21", "http://allowed.test/redirect"),
        ("22", "http://allowed.test/c"),
        ("23", "http://allowed.test/bomb"),
        ("24", "http://rebind.test/start"),
        ("25", "http://both.test/a"),
        ("26", "javascript:alert(1)"),
    ])
    .await;
    let denied = load(&storage, "20", "pv-local", &CancelFlag::new(), &fx.net).await;
    assert_eq!(denied.status, PreviewStatus::Failed);
    assert_eq!(denied.failure.0, Some(PreviewFailure::AddressDenied));
    assert_eq!(
        denied.failure_message.0.as_deref(),
        Some("地址指向受限网络")
    );
    assert!(denied.title.0.is_none() && denied.summary.0.is_none() && denied.image.0.is_none());
    let redirect = load(&storage, "21", "pv-redirect", &CancelFlag::new(), &fx.net).await;
    assert_eq!(redirect.failure.0, Some(PreviewFailure::RedirectDenied));
    assert_eq!(
        redirect.failure_message.0.as_deref(),
        Some("重定向指向受限地址")
    );
    let image = load(&storage, "22", "pv-image", &CancelFlag::new(), &fx.net).await;
    assert_eq!(image.status, PreviewStatus::Ready);
    assert_eq!(image.title.0.as_deref(), Some("Local Image"));
    assert!(image.image.0.is_none());
    assert_eq!(image.image_failure.0, Some(PreviewFailure::AddressDenied));
    assert_eq!(
        image.image_failure_message.0.as_deref(),
        Some("来源图片指向受限网络")
    );
    let bomb = load(&storage, "23", "pv-bomb", &CancelFlag::new(), &fx.net).await;
    assert_eq!(bomb.failure.0, Some(PreviewFailure::BodyTooLarge));
    assert_eq!(bomb.failure_message.0.as_deref(), Some("页面超过 5 MiB"));
    assert!(bomb.summary.0.is_none());
    let rebind = load(&storage, "24", "pv-rebind", &CancelFlag::new(), &fx.net).await;
    assert_eq!(rebind.failure.0, Some(PreviewFailure::RebindDenied));
    assert_eq!(
        rebind.failure_message.0.as_deref(),
        Some("域名解析结果发生变化")
    );
    let mixed = load(&storage, "25", "pv-both", &CancelFlag::new(), &fx.net).await;
    assert_eq!(mixed.failure.0, Some(PreviewFailure::AddressDenied));
    let scheme = load(&storage, "26", "pv-js", &CancelFlag::new(), &fx.net).await;
    assert_eq!(scheme.failure.0, Some(PreviewFailure::SchemeDenied));
    assert_eq!(fx.secret_hits.load(Ordering::SeqCst), 0);
    assert!(
        fx.net
            .dials
            .lock()
            .unwrap()
            .iter()
            .all(|addr| !addr.ip().is_loopback())
    );
}

#[tokio::test]
async fn http_fixture_switches_twenty_times_without_mixing_and_keeps_offline_cache() {
    let fx = fixture(Duration::from_millis(200), false).await;
    let storage = storage_with(&[
        ("10", "http://allowed.test/a"),
        ("11", "http://allowed.test/b"),
    ])
    .await;
    let gate = Gate::default();
    let mut flags = Vec::new();
    for index in 0..20 {
        flags.push(gate.begin(&id(&format!("pv{index}"))).await);
    }
    let mut tasks = Vec::new();
    for (index, flag) in flags.iter().enumerate() {
        let flag = flag.clone();
        let storage = storage.share();
        let net_answers = fx.net.answers.clone();
        let net_calls = fx.net.calls.clone();
        let net_routes = fx.net.routes.clone();
        let net_dials = fx.net.dials.clone();
        let net_refuse = fx.net.refuse.clone();
        tasks.push(tokio::spawn(async move {
            let net = FixtureNet {
                answers: net_answers,
                calls: net_calls,
                routes: net_routes,
                dials: net_dials,
                refuse: net_refuse,
            };
            let chrome = if index % 2 == 0 { "10" } else { "11" };
            load(&storage, chrome, &format!("pv{index}"), &flag, &net).await
        }));
    }
    tokio::time::sleep(Duration::from_millis(30)).await;
    for index in 0..19 {
        gate.cancel(&id(&format!("pv{index}"))).await;
    }
    let mut results = Vec::new();
    for task in tasks {
        results.push(task.await.unwrap());
    }
    for result in &results[..19] {
        assert_eq!(result.status, PreviewStatus::Cancelled);
        assert!(result.title.0.is_none());
        assert!(result.summary.0.is_none());
        assert!(result.image.0.is_none());
        assert!(result.failure_message.0.is_none());
        assert!(result.cache_label.0.is_none());
    }
    let current = &results[19];
    assert_eq!(current.status, PreviewStatus::Ready);
    assert_eq!(current.title.0.as_deref(), Some("No Image"));
    assert_eq!(current.request_id, id("pv19"));
    fx.net.refuse.store(true, Ordering::SeqCst);
    let offline = load(&storage, "11", "pv-offline", &CancelFlag::new(), &fx.net).await;
    assert_eq!(offline.status, PreviewStatus::Cached);
    assert_eq!(offline.title.0.as_deref(), Some("No Image"));
    assert_eq!(offline.summary.0.as_deref(), Some("只有文字"));
    let fetched_at = offline.fetched_at.0.unwrap().get();
    assert_eq!(
        offline.cache_label.0.as_deref(),
        Some(cache_time_label_for_test(fetched_at).as_str())
    );
    assert!(offline.cache_label.0.unwrap().starts_with("离线缓存 · "));
}

#[tokio::test]
async fn http_fixture_timeout_is_visible_at_ten_seconds() {
    let fx = fixture(Duration::ZERO, false).await;
    let storage = storage_with(&[("30", "http://allowed.test/hang")]).await;
    let started = Instant::now();
    let result = load(&storage, "30", "pv-hang", &CancelFlag::new(), &fx.net).await;
    let elapsed = started.elapsed();
    assert_eq!(result.status, PreviewStatus::Failed);
    assert_eq!(result.failure.0, Some(PreviewFailure::TimedOut));
    assert_eq!(result.failure_message.0.as_deref(), Some("抓取超过 10 秒"));
    assert!(result.title.0.is_none() && result.summary.0.is_none() && result.image.0.is_none());
    assert!(elapsed >= FETCH_TIMEOUT, "{elapsed:?}");
    assert!(
        elapsed < FETCH_TIMEOUT + Duration::from_secs(3),
        "{elapsed:?}"
    );
}

pub(super) fn cache_time_label_for_test(unix_millis: u64) -> String {
    super::service::cache_time_label(unix_millis)
}
