//! Local-only optional embedding service. This module never reads chat credentials.
pub(crate) mod transport;
pub(crate) use crate::ai::CancelFlag;
use markbridge_protocol::{Id, SemanticFailure, SourceEpoch};
use sha2::{Digest, Sha256};
pub(crate) use transport::{HttpTransport, Transport};

pub(crate) const RECIPE: u8 = 1;
pub(crate) const MAX_CHARS: usize = 8192;
pub(crate) const MAX_BYTES: usize = 32768;
pub(crate) const MAX_DIMENSION: usize = 4096;
pub(crate) type Result<T> = std::result::Result<T, SemanticFailure>;

pub(crate) fn endpoint(value: &str) -> Result<String> {
    if value.len() > 512 || value.contains('\\') || value.chars().any(char::is_control) {
        return Err(SemanticFailure::EndpointDenied);
    }
    let mut url = reqwest::Url::parse(value).map_err(|_| SemanticFailure::EndpointDenied)?;
    if url.scheme() != "http"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err(SemanticFailure::EndpointDenied);
    }
    match url.host() {
        Some(url::Host::Ipv4(ip)) if ip.is_loopback() => {}
        Some(url::Host::Ipv6(ip)) if ip.is_loopback() => {}
        Some(url::Host::Domain("localhost")) => {
            url.set_host(Some("127.0.0.1"))
                .map_err(|_| SemanticFailure::EndpointDenied)?;
        }
        _ => return Err(SemanticFailure::EndpointDenied),
    }
    Ok(url.to_string().trim_end_matches('/').to_owned())
}
pub(crate) fn model(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-/:".contains(&b))
    {
        return Err(SemanticFailure::MissingModel);
    }
    Ok(value.to_owned())
}
pub(crate) fn input(title: &str, summary: &str) -> (String, bool) {
    let raw = format!("Title:\n{title}\nSummary:\n{summary}");
    let mut bytes = 0;
    let mut chars = 0;
    let text: String = raw
        .chars()
        .take_while(|ch| {
            bytes += ch.len_utf8();
            chars += 1;
            chars <= MAX_CHARS && bytes <= MAX_BYTES
        })
        .collect();
    let clipped = text.len() != raw.len();
    (text, clipped)
}
pub(crate) fn fingerprint(
    profile: &Id,
    epoch: SourceEpoch,
    bookmark: &Id,
    title: &str,
    summary: &str,
) -> String {
    let data = serde_json::to_vec(&(
        "markbridge:semantic-input",
        RECIPE,
        profile.as_str(),
        epoch.get(),
        bookmark.as_str(),
        title,
        summary,
    ))
    .expect("string tuple");
    format!("{:x}", Sha256::digest(data))
}
pub(crate) fn normalize(values: Vec<f32>) -> Result<Vec<f32>> {
    if values.is_empty() || values.len() > MAX_DIMENSION || values.iter().any(|v| !v.is_finite()) {
        return Err(SemanticFailure::InvalidVector);
    }
    let scale = values
        .iter()
        .fold(0.0_f64, |a, b| a.max(f64::from(b.abs())));
    if scale == 0.0 {
        return Err(SemanticFailure::InvalidVector);
    }
    let norm = values
        .iter()
        .map(|v| (f64::from(*v) / scale).powi(2))
        .sum::<f64>()
        .sqrt();
    Ok(values
        .iter()
        .map(|v| (f64::from(*v) / scale / norm) as f32)
        .collect())
}
pub(crate) fn encode(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}
pub(crate) fn decode(bytes: &[u8], dimension: usize) -> Result<Vec<f32>> {
    if dimension == 0 || dimension > MAX_DIMENSION || bytes.len() != dimension * 4 {
        return Err(SemanticFailure::InvalidVector);
    }
    let values: Vec<_> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect();
    let norm = values
        .iter()
        .map(|value| f64::from(*value).powi(2))
        .sum::<f64>()
        .sqrt();
    if (norm - 1.0).abs() > 0.0001 {
        return Err(SemanticFailure::InvalidVector);
    }
    let normalized = normalize(values.clone())?;
    if values
        .iter()
        .zip(&normalized)
        .any(|(a, b)| (a - b).abs() > 0.001)
    {
        return Err(SemanticFailure::InvalidVector);
    }
    Ok(normalized)
}

#[cfg(test)]
pub(crate) mod tests;
