//! Public HTTP(S) fetch. There is no setting that allows loopback, private, or metadata addresses.
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, OnceLock},
    time::Duration,
};

use futures_util::future::BoxFuture;
use markbridge_protocol::PreviewFailure;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpStream,
    sync::watch,
};
use url::Url;

use super::guard::{self, CheckedUrl, is_forbidden_ip};

pub(crate) const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const MAX_REDIRECTS: usize = 5;
pub(crate) const MAX_DOCUMENT_BYTES: usize = 5 * 1024 * 1024;
pub(crate) const MAX_IMAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_HEADERS: usize = 64 * 1024;

#[derive(Clone, Copy)]
pub(crate) enum ResourceKind {
    Document,
    Image,
}

pub(crate) struct Fetched {
    pub body: Vec<u8>,
    pub media_type: String,
    pub final_url: Url,
}

pub(crate) enum FetchError {
    Denied(PreviewFailure),
    Cancelled,
}

#[derive(Clone)]
pub(crate) struct CancelFlag(Arc<watch::Sender<bool>>);

impl CancelFlag {
    pub(crate) fn new() -> Self {
        Self(Arc::new(watch::channel(false).0))
    }
    pub(crate) fn cancel(&self) {
        let _ = self.0.send(true);
    }
    pub(crate) fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }
    pub(crate) async fn cancelled(&self) {
        let mut watch = self.0.subscribe();
        loop {
            if *watch.borrow() {
                return;
            }
            if watch.changed().await.is_err() {
                return;
            }
        }
    }
}

pub(crate) trait Network: Send + Sync {
    fn resolve(
        &self,
        host: String,
        port: u16,
    ) -> BoxFuture<'static, Result<Vec<std::net::IpAddr>, PreviewFailure>>;
    fn connect(&self, addr: SocketAddr) -> BoxFuture<'static, Result<TcpStream, PreviewFailure>>;
}

pub(crate) struct SystemNetwork;

impl Network for SystemNetwork {
    fn resolve(
        &self,
        host: String,
        port: u16,
    ) -> BoxFuture<'static, Result<Vec<std::net::IpAddr>, PreviewFailure>> {
        Box::pin(async move {
            let looked = tokio::net::lookup_host((host.as_str(), port))
                .await
                .map_err(|_| PreviewFailure::Unreachable)?;
            let mut ips = Vec::new();
            for addr in looked {
                if !ips.contains(&addr.ip()) {
                    ips.push(addr.ip());
                }
            }
            Ok(ips)
        })
    }
    fn connect(&self, addr: SocketAddr) -> BoxFuture<'static, Result<TcpStream, PreviewFailure>> {
        Box::pin(async move {
            TcpStream::connect(addr)
                .await
                .map_err(|_| PreviewFailure::Unreachable)
        })
    }
}

pub(crate) async fn fetch_public(
    raw: &str,
    kind: ResourceKind,
    cancel: &CancelFlag,
    net: &dyn Network,
) -> Result<Fetched, FetchError> {
    if cancel.is_cancelled() {
        return Err(FetchError::Cancelled);
    }
    let limit = match kind {
        ResourceKind::Document => MAX_DOCUMENT_BYTES,
        ResourceKind::Image => MAX_IMAGE_BYTES,
    };
    let work = follow(raw, kind, limit, net);
    tokio::pin!(work);
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(FetchError::Cancelled),
        _ = tokio::time::sleep(FETCH_TIMEOUT) => Err(FetchError::Denied(PreviewFailure::TimedOut)),
        result = &mut work => result,
    }
}

async fn follow(
    raw: &str,
    kind: ResourceKind,
    limit: usize,
    net: &dyn Network,
) -> Result<Fetched, FetchError> {
    let mut current = raw.to_owned();
    let mut pinned: HashMap<String, SocketAddr> = HashMap::new();
    for hop in 0..=MAX_REDIRECTS {
        let checked = guard::check_url(&current).map_err(|error| {
            FetchError::Denied(if hop == 0 {
                error
            } else {
                redirect_error(error)
            })
        })?;
        let addr = pin_addr(&checked, &mut pinned, hop, net)
            .await
            .map_err(FetchError::Denied)?;
        let response = exchange(&checked, kind, addr, limit, net)
            .await
            .map_err(FetchError::Denied)?;
        if let Some(location) = response.location {
            if hop == MAX_REDIRECTS {
                return Err(FetchError::Denied(PreviewFailure::RedirectDenied));
            }
            current = guard::redirect_target(&checked.url, &location)
                .map_err(|error| FetchError::Denied(redirect_error(error)))?;
            continue;
        }
        return Ok(Fetched {
            body: response.body,
            media_type: response.media_type,
            final_url: checked.url,
        });
    }
    Err(FetchError::Denied(PreviewFailure::RedirectDenied))
}

fn redirect_error(error: PreviewFailure) -> PreviewFailure {
    match error {
        PreviewFailure::SchemeDenied
        | PreviewFailure::AddressDenied
        | PreviewFailure::UserinfoDenied => PreviewFailure::RedirectDenied,
        other => other,
    }
}

async fn pin_addr(
    checked: &CheckedUrl,
    pinned: &mut HashMap<String, SocketAddr>,
    hop: usize,
    net: &dyn Network,
) -> Result<SocketAddr, PreviewFailure> {
    let key = format!("{}:{}", checked.host, checked.port);
    let seen = pinned.contains_key(&key);
    let ips = if let Some(ip) = checked.literal {
        vec![ip]
    } else {
        net.resolve(checked.host.clone(), checked.port).await?
    };
    if ips.is_empty() {
        return Err(PreviewFailure::Unreachable);
    }
    if ips.iter().copied().any(is_forbidden_ip) {
        if seen {
            return Err(PreviewFailure::RebindDenied);
        }
        return Err(if hop == 0 {
            PreviewFailure::AddressDenied
        } else {
            PreviewFailure::RedirectDenied
        });
    }
    if let Some(addr) = pinned.get(&key) {
        return Ok(*addr);
    }
    let addr = SocketAddr::new(ips[0], checked.port);
    pinned.insert(key, addr);
    Ok(addr)
}

struct RawResponse {
    location: Option<String>,
    body: Vec<u8>,
    media_type: String,
}

async fn exchange(
    checked: &CheckedUrl,
    kind: ResourceKind,
    addr: SocketAddr,
    limit: usize,
    net: &dyn Network,
) -> Result<RawResponse, PreviewFailure> {
    let tcp = net.connect(addr).await?;
    if checked.url.scheme() == "https" {
        let name = rustls::pki_types::ServerName::try_from(checked.host.clone())
            .map_err(|_| PreviewFailure::InvalidResponse)?;
        let stream = tls_connector()
            .connect(name, tcp)
            .await
            .map_err(|_| PreviewFailure::Unreachable)?;
        read_http(stream, checked, kind, limit).await
    } else {
        read_http(tcp, checked, kind, limit).await
    }
}

fn tls_connector() -> &'static tokio_rustls::TlsConnector {
    static CONNECTOR: OnceLock<tokio_rustls::TlsConnector> = OnceLock::new();
    CONNECTOR.get_or_init(|| {
        let mut roots = rustls::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let config = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        tokio_rustls::TlsConnector::from(Arc::new(config))
    })
}

async fn read_http<S>(
    mut stream: S,
    checked: &CheckedUrl,
    kind: ResourceKind,
    limit: usize,
) -> Result<RawResponse, PreviewFailure>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let request = request_bytes(checked, kind)?;
    stream
        .write_all(&request)
        .await
        .map_err(|_| PreviewFailure::Unreachable)?;
    let header_bytes = read_until(&mut stream, b"\r\n\r\n", MAX_HEADERS).await?;
    let (status, headers) = parse_headers(&header_bytes)?;
    if matches!(status, 301 | 302 | 303 | 307 | 308) {
        let location = header(&headers, "location")
            .ok_or(PreviewFailure::InvalidResponse)?
            .to_owned();
        return Ok(RawResponse {
            location: Some(location),
            body: Vec::new(),
            media_type: String::new(),
        });
    }
    let failure = match status {
        200..=299 => None,
        401 | 403 => Some(PreviewFailure::LoginRequired),
        404 | 410 => Some(PreviewFailure::NotFound),
        _ => Some(PreviewFailure::InvalidResponse),
    };
    if let Some(failure) = failure {
        return Err(failure);
    }
    let encoding = header(&headers, "content-encoding")
        .unwrap_or("")
        .to_ascii_lowercase();
    if encoding
        .split(',')
        .filter(|value| !value.trim().is_empty())
        .count()
        > 1
    {
        return Err(PreviewFailure::InvalidResponse);
    }
    let compressed = read_body(&mut stream, &headers, limit).await?;
    let body = decode_body(encoding.trim(), &compressed, limit)?;
    let media_type = header(&headers, "content-type")
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    Ok(RawResponse {
        location: None,
        body,
        media_type,
    })
}

fn request_bytes(checked: &CheckedUrl, kind: ResourceKind) -> Result<Vec<u8>, PreviewFailure> {
    let path = checked.url.path();
    let path = if path.is_empty() { "/" } else { path };
    let query = checked
        .url
        .query()
        .map(|value| format!("?{value}"))
        .unwrap_or_default();
    if path.chars().any(|c| c.is_control()) || query.chars().any(|c| c.is_control()) {
        return Err(PreviewFailure::InvalidResponse);
    }
    let host = match checked.url.port() {
        Some(port) if !matches!((checked.url.scheme(), port), ("http", 80) | ("https", 443)) => {
            format!("{}:{port}", display_host(checked))
        }
        _ => display_host(checked),
    };
    let accept = match kind {
        ResourceKind::Document => "text/html,application/xhtml+xml;q=0.9",
        ResourceKind::Image => "image/gif,image/png,image/jpeg,image/webp",
    };
    Ok(format!("GET {path}{query} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: MarkbridgePreview/0.1\r\nAccept: {accept}\r\nAccept-Encoding: gzip, deflate\r\nConnection: close\r\n\r\n").into_bytes())
}

fn display_host(checked: &CheckedUrl) -> String {
    if checked.literal.is_some_and(|ip| ip.is_ipv6()) {
        format!("[{}]", checked.host)
    } else {
        checked.host.clone()
    }
}

async fn read_until<S: AsyncRead + Unpin>(
    stream: &mut S,
    marker: &[u8],
    limit: usize,
) -> Result<Vec<u8>, PreviewFailure> {
    let mut out = Vec::new();
    let mut buf = [0u8; 1];
    loop {
        if out.len() >= limit {
            return Err(PreviewFailure::BodyTooLarge);
        }
        let n = stream
            .read(&mut buf)
            .await
            .map_err(|_| PreviewFailure::Unreachable)?;
        if n == 0 {
            return Err(PreviewFailure::InvalidResponse);
        }
        out.push(buf[0]);
        if out.ends_with(marker) {
            return Ok(out);
        }
    }
}

fn parse_headers(bytes: &[u8]) -> Result<(u16, Vec<(String, String)>), PreviewFailure> {
    let text = std::str::from_utf8(bytes).map_err(|_| PreviewFailure::InvalidResponse)?;
    let mut lines = text.split("\r\n");
    let status = lines.next().ok_or(PreviewFailure::InvalidResponse)?;
    let mut parts = status.split(' ');
    let version = parts.next().ok_or(PreviewFailure::InvalidResponse)?;
    if version != "HTTP/1.0" && version != "HTTP/1.1" {
        return Err(PreviewFailure::InvalidResponse);
    }
    let code: u16 = parts
        .next()
        .ok_or(PreviewFailure::InvalidResponse)?
        .parse()
        .map_err(|_| PreviewFailure::InvalidResponse)?;
    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let (name, value) = line
            .split_once(':')
            .ok_or(PreviewFailure::InvalidResponse)?;
        headers.push((name.trim().to_ascii_lowercase(), value.trim().to_owned()));
    }
    Ok((code, headers))
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

async fn read_body<S: AsyncRead + Unpin>(
    stream: &mut S,
    headers: &[(String, String)],
    limit: usize,
) -> Result<Vec<u8>, PreviewFailure> {
    if header(headers, "transfer-encoding")
        .is_some_and(|value| value.eq_ignore_ascii_case("chunked"))
    {
        return read_chunked(stream, limit).await;
    }
    if let Some(length) = header(headers, "content-length") {
        let length: usize = length
            .parse()
            .map_err(|_| PreviewFailure::InvalidResponse)?;
        if length > limit {
            return Err(PreviewFailure::BodyTooLarge);
        }
        let mut body = vec![0u8; length];
        stream
            .read_exact(&mut body)
            .await
            .map_err(|_| PreviewFailure::Unreachable)?;
        return Ok(body);
    }
    let mut body = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = stream
            .read(&mut buf)
            .await
            .map_err(|_| PreviewFailure::Unreachable)?;
        if n == 0 {
            return Ok(body);
        }
        if body.len() + n > limit {
            return Err(PreviewFailure::BodyTooLarge);
        }
        body.extend_from_slice(&buf[..n]);
    }
}

async fn read_chunked<S: AsyncRead + Unpin>(
    stream: &mut S,
    limit: usize,
) -> Result<Vec<u8>, PreviewFailure> {
    let mut body = Vec::new();
    loop {
        let line = read_until(stream, b"\r\n", 4096).await?;
        let text = std::str::from_utf8(&line).map_err(|_| PreviewFailure::InvalidResponse)?;
        let size = usize::from_str_radix(
            text.trim()
                .trim_end_matches(['\r', '\n'])
                .split(';')
                .next()
                .unwrap_or(""),
            16,
        )
        .map_err(|_| PreviewFailure::InvalidResponse)?;
        if size == 0 {
            let _ = read_until(stream, b"\r\n", 4096).await;
            return Ok(body);
        }
        if body.len() + size > limit {
            return Err(PreviewFailure::BodyTooLarge);
        }
        let mut chunk = vec![0u8; size];
        stream
            .read_exact(&mut chunk)
            .await
            .map_err(|_| PreviewFailure::Unreachable)?;
        let mut crlf = [0u8; 2];
        stream
            .read_exact(&mut crlf)
            .await
            .map_err(|_| PreviewFailure::Unreachable)?;
        if &crlf != b"\r\n" {
            return Err(PreviewFailure::InvalidResponse);
        }
        body.extend_from_slice(&chunk);
    }
}

fn decode_body(encoding: &str, bytes: &[u8], limit: usize) -> Result<Vec<u8>, PreviewFailure> {
    if bytes.len() > limit {
        return Err(PreviewFailure::BodyTooLarge);
    }
    match encoding {
        "" | "identity" => Ok(bytes.to_vec()),
        "gzip" => inflate(flate2::read::GzDecoder::new(bytes), limit),
        "deflate" => inflate(flate2::read::DeflateDecoder::new(bytes), limit),
        _ => Err(PreviewFailure::InvalidResponse),
    }
}

fn inflate<R: std::io::Read>(mut decoder: R, limit: usize) -> Result<Vec<u8>, PreviewFailure> {
    let mut out = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = decoder
            .read(&mut buf)
            .map_err(|_| PreviewFailure::InvalidResponse)?;
        if n == 0 {
            return Ok(out);
        }
        if out.len() + n > limit {
            return Err(PreviewFailure::BodyTooLarge);
        }
        out.extend_from_slice(&buf[..n]);
    }
}

pub(crate) const PROBE_BODY_LIMIT: usize = 64 * 1024;

pub(crate) struct ProbeHit {
    pub status: u16,
    pub login_page: bool,
}

pub(crate) enum ProbeError {
    Cancelled,
    Denied(PreviewFailure),
}

struct StatusRead {
    code: u16,
    location: Option<String>,
    body: Vec<u8>,
}

/// HEAD, then a small GET when HEAD cannot be used or the response may be a login page.
/// Address checks are the same as a document fetch.
pub(crate) async fn probe_public(
    raw: &str,
    cancel: &CancelFlag,
    net: &dyn Network,
) -> Result<ProbeHit, ProbeError> {
    if cancel.is_cancelled() {
        return Err(ProbeError::Cancelled);
    }
    let work = probe_follow(raw, net);
    tokio::pin!(work);
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(ProbeError::Cancelled),
        _ = tokio::time::sleep(FETCH_TIMEOUT) => Err(ProbeError::Denied(PreviewFailure::TimedOut)),
        result = &mut work => result,
    }
}

async fn probe_follow(raw: &str, net: &dyn Network) -> Result<ProbeHit, ProbeError> {
    let mut current = raw.to_owned();
    let mut pinned = HashMap::new();
    for hop in 0..=MAX_REDIRECTS {
        let checked = guard::check_url(&current).map_err(|error| {
            ProbeError::Denied(if hop == 0 {
                error
            } else {
                redirect_error(error)
            })
        })?;
        let addr = pin_addr(&checked, &mut pinned, hop, net)
            .await
            .map_err(ProbeError::Denied)?;
        let mut status = match read_status(&checked, "HEAD", false, addr, net).await {
            Ok(status) => status,
            Err(PreviewFailure::Unreachable) | Err(PreviewFailure::InvalidResponse) => {
                read_status(&checked, "GET", true, addr, net)
                    .await
                    .map_err(ProbeError::Denied)?
            }
            Err(error) => return Err(ProbeError::Denied(error)),
        };
        if matches!(status.code, 405 | 501) {
            status = read_status(&checked, "GET", true, addr, net)
                .await
                .map_err(ProbeError::Denied)?;
        }
        if let Some(location) = status.location.clone() {
            if hop == MAX_REDIRECTS {
                return Err(ProbeError::Denied(PreviewFailure::RedirectDenied));
            }
            current = guard::redirect_target(&checked.url, &location)
                .map_err(|error| ProbeError::Denied(redirect_error(error)))?;
            continue;
        }
        if (200..300).contains(&status.code) && status.body.is_empty() {
            if let Ok(got) = read_status(&checked, "GET", true, addr, net).await {
                if let Some(location) = got.location {
                    if hop == MAX_REDIRECTS {
                        return Err(ProbeError::Denied(PreviewFailure::RedirectDenied));
                    }
                    current = guard::redirect_target(&checked.url, &location)
                        .map_err(|error| ProbeError::Denied(redirect_error(error)))?;
                    continue;
                }
                status = got;
            }
        }
        return Ok(ProbeHit {
            status: status.code,
            login_page: login_page(status.code, &status.body),
        });
    }
    Err(ProbeError::Denied(PreviewFailure::RedirectDenied))
}

fn login_page(status: u16, body: &[u8]) -> bool {
    if status == 401 {
        return true;
    }
    if !(200..300).contains(&status) {
        return false;
    }
    let lower = String::from_utf8_lossy(body).to_ascii_lowercase();
    lower.contains("type=\"password\"") || lower.contains("type='password'")
}

async fn read_status(
    checked: &CheckedUrl,
    method: &str,
    with_body: bool,
    addr: SocketAddr,
    net: &dyn Network,
) -> Result<StatusRead, PreviewFailure> {
    let tcp = net.connect(addr).await?;
    if checked.url.scheme() == "https" {
        let name = rustls::pki_types::ServerName::try_from(checked.host.clone())
            .map_err(|_| PreviewFailure::InvalidResponse)?;
        let stream = tls_connector()
            .connect(name, tcp)
            .await
            .map_err(|_| PreviewFailure::Unreachable)?;
        read_status_http(stream, checked, method, with_body).await
    } else {
        read_status_http(tcp, checked, method, with_body).await
    }
}

async fn read_status_http<S>(
    mut stream: S,
    checked: &CheckedUrl,
    method: &str,
    with_body: bool,
) -> Result<StatusRead, PreviewFailure>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    stream
        .write_all(&status_request(checked, method)?)
        .await
        .map_err(|_| PreviewFailure::Unreachable)?;
    let header_bytes = read_until(&mut stream, b"\r\n\r\n", MAX_HEADERS).await?;
    let (code, headers) = parse_headers(&header_bytes)?;
    if matches!(code, 301 | 302 | 303 | 307 | 308) {
        let location = header(&headers, "location")
            .ok_or(PreviewFailure::InvalidResponse)?
            .to_owned();
        return Ok(StatusRead {
            code,
            location: Some(location),
            body: Vec::new(),
        });
    }
    let body = if with_body {
        match read_prefix(&mut stream, &headers, PROBE_BODY_LIMIT).await {
            Ok(body) => body,
            Err(PreviewFailure::BodyTooLarge) => Vec::new(),
            Err(error) => return Err(error),
        }
    } else {
        Vec::new()
    };
    Ok(StatusRead {
        code,
        location: None,
        body,
    })
}

fn status_request(checked: &CheckedUrl, method: &str) -> Result<Vec<u8>, PreviewFailure> {
    if method != "GET" && method != "HEAD" {
        return Err(PreviewFailure::InvalidResponse);
    }
    let path = checked.url.path();
    let path = if path.is_empty() { "/" } else { path };
    let query = checked
        .url
        .query()
        .map(|value| format!("?{value}"))
        .unwrap_or_default();
    if path.chars().any(|ch| ch.is_control()) || query.chars().any(|ch| ch.is_control()) {
        return Err(PreviewFailure::InvalidResponse);
    }
    let host = match checked.url.port() {
        Some(port) if !matches!((checked.url.scheme(), port), ("http", 80) | ("https", 443)) => {
            format!("{}:{port}", display_host(checked))
        }
        _ => display_host(checked),
    };
    Ok(format!("{method} {path}{query} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: MarkbridgePreview/0.1\r\nAccept: text/html\r\nConnection: close\r\n\r\n").into_bytes())
}

async fn read_prefix<S: AsyncRead + Unpin>(
    stream: &mut S,
    headers: &[(String, String)],
    limit: usize,
) -> Result<Vec<u8>, PreviewFailure> {
    if header(headers, "transfer-encoding")
        .is_some_and(|value| value.eq_ignore_ascii_case("chunked"))
    {
        return read_chunked(stream, limit).await;
    }
    let wanted = header(headers, "content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(limit)
        .min(limit);
    if wanted == 0 {
        return Ok(Vec::new());
    }
    let mut body = vec![0_u8; wanted];
    let mut filled = 0;
    while filled < wanted {
        let n = stream
            .read(&mut body[filled..])
            .await
            .map_err(|_| PreviewFailure::Unreachable)?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    body.truncate(filled);
    Ok(body)
}
