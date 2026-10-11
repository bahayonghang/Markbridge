use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use markbridge_protocol::PreviewFailure;
use url::Host;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CheckedUrl {
    pub url: url::Url,
    pub host: String,
    pub port: u16,
    pub literal: Option<IpAddr>,
}

pub(crate) fn check_url(raw: &str) -> Result<CheckedUrl, PreviewFailure> {
    if raw.len() > 16_384 || raw.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(PreviewFailure::SchemeDenied);
    }
    let url = url::Url::parse(raw).map_err(|_| PreviewFailure::SchemeDenied)?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(PreviewFailure::SchemeDenied);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(PreviewFailure::UserinfoDenied);
    }
    let port = url
        .port_or_known_default()
        .filter(|port| *port != 0)
        .ok_or(PreviewFailure::AddressDenied)?;
    match url.host() {
        Some(Host::Domain(domain)) => {
            let host = domain.trim_end_matches('.').to_ascii_lowercase();
            if host.is_empty()
                || host == "localhost"
                || host.ends_with(".localhost")
                || host == "metadata.google.internal"
                || host == "metadata.goog"
                || numeric_host(&host)
            {
                return Err(PreviewFailure::AddressDenied);
            }
            Ok(CheckedUrl {
                url,
                host,
                port,
                literal: None,
            })
        }
        Some(Host::Ipv4(ip)) => {
            if is_forbidden_ip(IpAddr::V4(ip)) {
                return Err(PreviewFailure::AddressDenied);
            }
            Ok(CheckedUrl {
                host: ip.to_string(),
                url,
                port,
                literal: Some(IpAddr::V4(ip)),
            })
        }
        Some(Host::Ipv6(ip)) => {
            if is_forbidden_ip(IpAddr::V6(ip)) {
                return Err(PreviewFailure::AddressDenied);
            }
            Ok(CheckedUrl {
                host: ip.to_string(),
                url,
                port,
                literal: Some(IpAddr::V6(ip)),
            })
        }
        None => Err(PreviewFailure::AddressDenied),
    }
}

pub(crate) fn is_forbidden_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => forbidden_v4(ip),
        IpAddr::V6(ip) => {
            ip.to_ipv4_mapped().is_some_and(forbidden_v4)
                || ip.to_ipv4().is_some_and(forbidden_v4)
                || forbidden_v6(ip)
        }
    }
}

fn numeric_host(host: &str) -> bool {
    let bytes = host.as_bytes();
    !bytes.is_empty()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_hexdigit() || matches!(byte, b'.' | b'x'))
        && bytes.iter().any(|byte| byte.is_ascii_digit())
}

fn forbidden_v4(ip: Ipv4Addr) -> bool {
    let [a, b, _, _] = ip.octets();
    ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_broadcast()
        || a == 0
        || a >= 240
        || (a == 100 && (b & 0xc0) == 0x40)
}

fn forbidden_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80
        || (first & 0xffc0) == 0xfec0
}

pub(crate) fn redirect_target(
    current: &url::Url,
    location: &str,
) -> Result<String, PreviewFailure> {
    if location.is_empty()
        || location
            .chars()
            .any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(PreviewFailure::InvalidResponse);
    }
    let next = current
        .join(location)
        .map_err(|_| PreviewFailure::InvalidResponse)?;
    Ok(next.to_string())
}
