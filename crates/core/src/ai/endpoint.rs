//! User-configured model endpoints. This is not the public page fetch client.
use std::net::IpAddr;

use markbridge_protocol::AiProviderKind;
use url::{Host, Url};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChatEndpoint {
    pub url: String,
}

pub(crate) fn chat_endpoint(kind: AiProviderKind, raw: &str) -> Result<ChatEndpoint, ()> {
    if raw.len() > 512 || raw.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
        return Err(());
    }
    let mut url = Url::parse(raw).map_err(|_| ())?;
    if url.query().is_some() || url.fragment().is_some() {
        return Err(());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(());
    }
    if url.port_or_known_default().is_none_or(|port| port == 0) {
        return Err(());
    }
    let https = match url.scheme() {
        "https" => true,
        "http" => false,
        _ => return Err(()),
    };
    if forbidden_host(&url) {
        return Err(());
    }
    if !https && !loopback_host(&url) {
        return Err(());
    }
    let path = normalized_path(url.path());
    let next = match kind {
        AiProviderKind::Ollama => ollama_path(path)?.to_owned(),
        AiProviderKind::Compatible => compatible_path(path)?,
    };
    url.set_path(&next);
    Ok(ChatEndpoint {
        url: url.to_string(),
    })
}

fn normalized_path(path: &str) -> &str {
    let path = path.trim_end_matches('/');
    if path.is_empty() { "/" } else { path }
}

fn segments(path: &str) -> Vec<&str> {
    path.split('/').filter(|part| !part.is_empty()).collect()
}

fn ollama_path(path: &str) -> Result<&'static str, ()> {
    let parts = segments(path);
    if parts.is_empty() {
        return Ok("/api/chat");
    }
    if parts == ["api", "chat"] {
        return Ok("/api/chat");
    }
    Err(())
}

fn compatible_path(path: &str) -> Result<String, ()> {
    let parts = segments(path);
    if parts.is_empty() {
        return Ok("/v1/chat/completions".to_owned());
    }
    if parts.len() >= 2
        && parts[parts.len() - 2] == "chat"
        && parts[parts.len() - 1] == "completions"
    {
        return Ok(path.to_owned());
    }
    if parts.last() == Some(&"v1") {
        return Ok(format!("{path}/chat/completions"));
    }
    Err(())
}

fn loopback_host(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(host)) => host.trim_end_matches('.').eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(ip)) => ip.is_loopback(),
        Some(Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

fn forbidden_host(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(host)) => {
            let host = host.trim_end_matches('.').to_ascii_lowercase();
            host.is_empty() || host == "metadata.google.internal" || host == "metadata.goog"
        }
        Some(Host::Ipv4(ip)) => forbidden_ip(IpAddr::V4(ip)),
        Some(Host::Ipv6(ip)) => forbidden_ip(IpAddr::V6(ip)),
        None => true,
    }
}

fn forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_multicast()
                || ip.is_link_local()
                || ip.octets() == [169, 254, 169, 254]
        }
        IpAddr::V6(ip) => {
            ip.is_unspecified()
                || ip.is_multicast()
                || (ip.segments()[0] & 0xffc0) == 0xfe80
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|ip| forbidden_ip(IpAddr::V4(ip)))
        }
    }
}

pub(crate) fn model_name(raw: &str) -> Result<String, ()> {
    let value = raw.trim();
    let length = value.chars().count();
    if !(1..=128).contains(&length) {
        return Err(());
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"._:/-".contains(&byte))
    {
        return Err(());
    }
    Ok(value.to_owned())
}
