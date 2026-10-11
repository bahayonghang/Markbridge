use std::{
    collections::HashMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use markbridge_protocol::{
    ContentPreview, Counter, ErrorCode, Id, ImageMediaType, PreviewFailure, PreviewImage,
    PreviewStatus, RequiredNullable, SummarySource,
};
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

use crate::storage::{Storage, preview::NewPreview};

use super::{
    extract::extract_html,
    fetch::{self, CancelFlag, FetchError, Network, ResourceKind},
    guard,
};

pub(crate) const MAX_CACHE_BYTES: i64 = 200 * 1024 * 1024;

#[derive(Clone, Default)]
pub struct Gate {
    inner: Arc<Mutex<HashMap<String, CancelFlag>>>,
}

impl Gate {
    pub(crate) async fn begin(&self, request_id: &Id) -> CancelFlag {
        let flag = CancelFlag::new();
        self.inner
            .lock()
            .await
            .insert(request_id.as_str().to_owned(), flag.clone());
        flag
    }
    pub async fn cancel(&self, request_id: &Id) {
        if let Some(flag) = self.inner.lock().await.get(request_id.as_str()) {
            flag.cancel();
        }
    }
    pub async fn cancel_all(&self) {
        for flag in self.inner.lock().await.values() {
            flag.cancel();
        }
    }
}

pub(crate) async fn load_content_preview(
    storage: &Storage,
    profile_id: Id,
    chrome_id: Id,
    request_id: Id,
    flag: &CancelFlag,
    net: &dyn Network,
) -> Result<ContentPreview, ErrorCode> {
    let live = storage
        .live_bookmark(profile_id.clone(), chrome_id.clone())
        .await?;
    let Some(live) = live else {
        return Err(ErrorCode::InvalidMessage);
    };
    if flag.is_cancelled() {
        return Ok(cancelled(
            &request_id,
            &profile_id,
            &chrome_id,
            &live.bookmark_id,
        ));
    }
    let Some(url) = live.url.filter(|url| !url.is_empty()) else {
        return Ok(failed(
            &request_id,
            &profile_id,
            &chrome_id,
            &live.bookmark_id,
            PreviewFailure::NoUrl,
        ));
    };
    let checked = match guard::check_url(&url) {
        Ok(checked) => checked,
        Err(failure) => {
            return Ok(failed(
                &request_id,
                &profile_id,
                &chrome_id,
                &live.bookmark_id,
                failure,
            ));
        }
    };
    let fingerprint = url_fingerprint(&checked.url);
    let fetched =
        fetch::fetch_public(checked.url.as_str(), ResourceKind::Document, flag, net).await;
    if flag.is_cancelled() {
        return Ok(cancelled(
            &request_id,
            &profile_id,
            &chrome_id,
            &live.bookmark_id,
        ));
    }
    let document = match fetched {
        Err(FetchError::Cancelled) => {
            return Ok(cancelled(
                &request_id,
                &profile_id,
                &chrome_id,
                &live.bookmark_id,
            ));
        }
        Err(FetchError::Denied(PreviewFailure::Unreachable)) => {
            return cached_or_failed(
                storage,
                &request_id,
                &profile_id,
                &chrome_id,
                &live.bookmark_id,
                &fingerprint,
                PreviewFailure::Unreachable,
            )
            .await;
        }
        Err(FetchError::Denied(failure)) => {
            return Ok(failed(
                &request_id,
                &profile_id,
                &chrome_id,
                &live.bookmark_id,
                failure,
            ));
        }
        Ok(document) => document,
    };
    if !is_html(&document.media_type, &document.body) {
        return Ok(failed(
            &request_id,
            &profile_id,
            &chrome_id,
            &live.bookmark_id,
            PreviewFailure::NotHtml,
        ));
    }
    let extracted = extract_html(&String::from_utf8_lossy(&document.body));
    let (image, image_failure) = load_image(
        &document.final_url,
        extracted.image_ref.as_deref(),
        extracted.image_label,
        flag,
        net,
    )
    .await;
    if flag.is_cancelled() {
        return Ok(cancelled(
            &request_id,
            &profile_id,
            &chrome_id,
            &live.bookmark_id,
        ));
    }
    let fetched_at = now_millis()?;
    let summary_source = extracted.summary_source.and_then(parse_source);
    let stored_image = image.as_ref().map(|image| {
        (
            image.media_type.as_str().to_owned(),
            image.data_base64.clone(),
            image.source_label.clone(),
        )
    });
    let size = i64::try_from(
        extracted.title.as_ref().map_or(0, |value| value.len())
            + extracted.summary.as_ref().map_or(0, |value| value.len())
            + stored_image.as_ref().map_or(0, |(_, data, _)| data.len()),
    )
    .unwrap_or(i64::MAX);
    storage
        .write_preview(
            NewPreview {
                bookmark_id: live.bookmark_id.clone(),
                fingerprint,
                stored: crate::storage::preview::StoredPreview {
                    title: extracted.title.clone(),
                    summary: extracted.summary.clone(),
                    summary_source: extracted.summary_source.map(str::to_owned),
                    image_base64: stored_image.as_ref().map(|(_, data, _)| data.clone()),
                    image_media_type: stored_image.as_ref().map(|(media, _, _)| media.clone()),
                    image_label: stored_image.as_ref().map(|(_, _, label)| label.clone()),
                    fetched_at,
                },
                size,
            },
            MAX_CACHE_BYTES,
        )
        .await?;
    if flag.is_cancelled() {
        return Ok(cancelled(
            &request_id,
            &profile_id,
            &chrome_id,
            &live.bookmark_id,
        ));
    }
    Ok(ContentPreview {
        request_id,
        profile_id,
        chrome_id,
        bookmark_id: live.bookmark_id,
        status: PreviewStatus::Ready,
        title: RequiredNullable(extracted.title),
        summary: RequiredNullable(extracted.summary),
        summary_source: RequiredNullable(summary_source),
        image: RequiredNullable(image),
        image_failure: RequiredNullable(image_failure),
        image_failure_message: RequiredNullable(
            image_failure
                .map(PreviewFailure::image_message)
                .map(str::to_owned),
        ),
        fetched_at: RequiredNullable(Some(Counter::new(fetched_at)?)),
        cache_label: RequiredNullable(None),
        failure: RequiredNullable(None),
        failure_message: RequiredNullable(None),
    })
}

async fn load_image(
    base: &url::Url,
    raw: Option<&str>,
    label: Option<&str>,
    flag: &CancelFlag,
    net: &dyn Network,
) -> (Option<PreviewImage>, Option<PreviewFailure>) {
    let Some(raw) = raw.filter(|value| !value.is_empty()) else {
        return (None, None);
    };
    let Ok(joined) = base.join(raw) else {
        return (None, Some(PreviewFailure::InvalidResponse));
    };
    if let Err(failure) = guard::check_url(joined.as_str()) {
        return (None, Some(failure));
    }
    match fetch::fetch_public(joined.as_str(), ResourceKind::Image, flag, net).await {
        Err(FetchError::Cancelled) => (None, None),
        Err(FetchError::Denied(failure)) => (None, Some(failure)),
        Ok(fetched) => match sniff(&fetched.body) {
            Some(media_type) => (
                Some(PreviewImage {
                    media_type,
                    data_base64: base64_encode(&fetched.body),
                    source_label: label.unwrap_or("og:image").to_owned(),
                }),
                None,
            ),
            None => (None, Some(PreviewFailure::InvalidResponse)),
        },
    }
}

async fn cached_or_failed(
    storage: &Storage,
    request_id: &Id,
    profile_id: &Id,
    chrome_id: &Id,
    bookmark_id: &Id,
    fingerprint: &str,
    failure: PreviewFailure,
) -> Result<ContentPreview, ErrorCode> {
    let now = i64::try_from(now_millis()?).map_err(|_| ErrorCode::StorageError)?;
    if let Some(row) = storage
        .read_preview(bookmark_id.clone(), fingerprint.to_owned(), now)
        .await?
    {
        let image = row.image_base64.as_deref().and_then(|value| {
            let bytes = base64_decode(value)?;
            Some(PreviewImage {
                media_type: sniff(&bytes)?,
                data_base64: value.to_owned(),
                source_label: row
                    .image_label
                    .clone()
                    .unwrap_or_else(|| "og:image".to_owned()),
            })
        });
        return Ok(ContentPreview {
            request_id: request_id.clone(),
            profile_id: profile_id.clone(),
            chrome_id: chrome_id.clone(),
            bookmark_id: bookmark_id.clone(),
            status: PreviewStatus::Cached,
            title: RequiredNullable(row.title),
            summary: RequiredNullable(row.summary),
            summary_source: RequiredNullable(row.summary_source.as_deref().and_then(parse_source)),
            image: RequiredNullable(image),
            image_failure: RequiredNullable(None),
            image_failure_message: RequiredNullable(None),
            fetched_at: RequiredNullable(Some(Counter::new(row.fetched_at)?)),
            cache_label: RequiredNullable(Some(cache_time_label(row.fetched_at))),
            failure: RequiredNullable(None),
            failure_message: RequiredNullable(None),
        });
    }
    Ok(failed(
        request_id,
        profile_id,
        chrome_id,
        bookmark_id,
        failure,
    ))
}

fn failed(
    request_id: &Id,
    profile_id: &Id,
    chrome_id: &Id,
    bookmark_id: &Id,
    failure: PreviewFailure,
) -> ContentPreview {
    let mut preview = blank(
        request_id,
        profile_id,
        chrome_id,
        bookmark_id,
        PreviewStatus::Failed,
    );
    preview.failure = RequiredNullable(Some(failure));
    preview.failure_message = RequiredNullable(Some(failure.message().to_owned()));
    preview
}

fn cancelled(request_id: &Id, profile_id: &Id, chrome_id: &Id, bookmark_id: &Id) -> ContentPreview {
    blank(
        request_id,
        profile_id,
        chrome_id,
        bookmark_id,
        PreviewStatus::Cancelled,
    )
}

fn blank(
    request_id: &Id,
    profile_id: &Id,
    chrome_id: &Id,
    bookmark_id: &Id,
    status: PreviewStatus,
) -> ContentPreview {
    ContentPreview {
        request_id: request_id.clone(),
        profile_id: profile_id.clone(),
        chrome_id: chrome_id.clone(),
        bookmark_id: bookmark_id.clone(),
        status,
        title: RequiredNullable(None),
        summary: RequiredNullable(None),
        summary_source: RequiredNullable(None),
        image: RequiredNullable(None),
        image_failure: RequiredNullable(None),
        image_failure_message: RequiredNullable(None),
        fetched_at: RequiredNullable(None),
        cache_label: RequiredNullable(None),
        failure: RequiredNullable(None),
        failure_message: RequiredNullable(None),
    }
}

fn parse_source(value: &str) -> Option<SummarySource> {
    match value {
        "description" => Some(SummarySource::Description),
        "excerpt" => Some(SummarySource::Excerpt),
        _ => None,
    }
}

fn is_html(media: &str, body: &[u8]) -> bool {
    if media == "text/html" || media == "application/xhtml+xml" {
        return true;
    }
    if !media.is_empty() {
        return false;
    }
    let start = body
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(0);
    let head = &body[start..body.len().min(start + 16)];
    let lower = head.to_ascii_lowercase();
    lower.starts_with(b"<html")
        || lower.starts_with(b"<!doc")
        || lower.starts_with(b"<head")
        || lower.starts_with(b"<body")
}

fn sniff(bytes: &[u8]) -> Option<ImageMediaType> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(ImageMediaType::Png)
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(ImageMediaType::Jpeg)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(ImageMediaType::Gif)
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(ImageMediaType::Webp)
    } else {
        None
    }
}

pub(crate) fn url_fingerprint(url: &url::Url) -> String {
    let mut clean = url.clone();
    clean.set_fragment(None);
    let _ = clean.set_username("");
    let _ = clean.set_password(None);
    let mut hasher = Sha256::new();
    hasher.update(clean.as_str().as_bytes());
    hex(&hasher.finalize())
}

fn now_millis() -> Result<u64, ErrorCode> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| ErrorCode::StorageError)?;
    u64::try_from(duration.as_millis()).map_err(|_| ErrorCode::StorageError)
}

pub(crate) fn cache_time_label(unix_millis: u64) -> String {
    let secs = i64::try_from(unix_millis / 1000).unwrap_or(i64::MAX);
    let hour = u32::try_from(secs.div_euclid(3600).rem_euclid(24)).unwrap_or(0);
    let minute = u32::try_from(secs.div_euclid(60).rem_euclid(60)).unwrap_or(0);
    let z = secs.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = u64::try_from(z.rem_euclid(146_097)).unwrap_or(0);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = i64::try_from(yoe).unwrap_or(0) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    format!("离线缓存 · {year:04}-{month:02}-{day:02} {hour:02}:{minute:02} UTC")
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0xf) as usize] as char);
    }
    out
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut index = 0;
    while index + 3 <= bytes.len() {
        let value = ((bytes[index] as u32) << 16)
            | ((bytes[index + 1] as u32) << 8)
            | bytes[index + 2] as u32;
        for shift in [18, 12, 6, 0] {
            out.push(TABLE[((value >> shift) & 63) as usize] as char);
        }
        index += 3;
    }
    let rest = bytes.len() - index;
    if rest == 1 {
        let value = (bytes[index] as u32) << 16;
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rest == 2 {
        let value = ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8);
        out.push(TABLE[((value >> 18) & 63) as usize] as char);
        out.push(TABLE[((value >> 12) & 63) as usize] as char);
        out.push(TABLE[((value >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

fn base64_decode(value: &str) -> Option<Vec<u8>> {
    let bytes = value.as_bytes();
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        let chunk = &bytes[index..index + 4];
        let values = [
            b64_value(chunk[0])?,
            b64_value(chunk[1])?,
            if chunk[2] == b'=' {
                0
            } else {
                b64_value(chunk[2])?
            },
            if chunk[3] == b'=' {
                0
            } else {
                b64_value(chunk[3])?
            },
        ];
        out.push((values[0] << 2) | (values[1] >> 4));
        if chunk[2] != b'=' {
            out.push((values[1] << 4) | (values[2] >> 2));
        }
        if chunk[3] != b'=' {
            out.push((values[2] << 6) | values[3]);
        }
        index += 4;
    }
    Some(out)
}

fn b64_value(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}
