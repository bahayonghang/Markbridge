//! Local tag names and the optional title codec. This module does not write Chrome or SQLite.
use markbridge_protocol::ErrorCode;
use unicode_normalization::UnicodeNormalization;

pub const TAG_MAX_CHARS: usize = 32;
pub const TAGS_PER_BOOKMARK: usize = 50;
pub const NOTE_MAX_CHARS: usize = 4_096;
pub const TITLE_MAX_CHARS: usize = 4_096;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedTag {
    pub display: String,
    pub key: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TitleDecision {
    Unchanged,
    Conflict,
    Write { raw: String, title: String },
}

/// Trim, NFC, then Unicode lowercase. The display keeps the first preferred casing.
pub fn normalize_tag(input: &str) -> Result<NormalizedTag, ErrorCode> {
    let display = nfc(input.trim());
    if display.is_empty() || display.chars().any(char::is_control) {
        return Err(ErrorCode::InvalidMessage);
    }
    if display.chars().count() > TAG_MAX_CHARS {
        return Err(ErrorCode::LimitExceeded);
    }
    Ok(NormalizedTag {
        key: nfc(&display.to_lowercase()),
        display,
    })
}

pub fn note_ok(note: &str) -> Result<(), ErrorCode> {
    if note.chars().count() > NOTE_MAX_CHARS {
        return Err(ErrorCode::LimitExceeded);
    }
    if note
        .chars()
        .any(|ch| ch.is_control() && ch != '\n' && ch != '\t')
    {
        return Err(ErrorCode::InvalidMessage);
    }
    Ok(())
}

/// Escape `\` and `|` so an unescaped ` | ` is the only separator this encoder writes.
pub fn encode_title(raw: &str, tags: &[&str]) -> Result<String, ErrorCode> {
    let mut out = escape(raw);
    for tag in tags {
        out.push_str(" | ");
        out.push_str(&escape(tag));
    }
    if out.chars().count() > TITLE_MAX_CHARS {
        return Err(ErrorCode::LimitExceeded);
    }
    Ok(out)
}

pub fn decode_title(encoded: &str) -> Result<(String, Vec<String>), ErrorCode> {
    let chars: Vec<char> = encoded.chars().collect();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '\\' {
            index += 1;
            let escaped = chars.get(index).copied().ok_or(ErrorCode::InvalidMessage)?;
            current.push(escaped);
            index += 1;
            continue;
        }
        if chars[index] == ' '
            && chars.get(index + 1) == Some(&'|')
            && chars.get(index + 2) == Some(&' ')
        {
            parts.push(std::mem::take(&mut current));
            index += 3;
            continue;
        }
        current.push(chars[index]);
        index += 1;
    }
    parts.push(current);
    let raw = parts.remove(0);
    Ok((raw, parts))
}

/// Encode from the stored raw title. An external title is a conflict and is not parsed into tags.
pub fn decide_encode(
    current: &str,
    raw: Option<&str>,
    last_encoded: Option<&str>,
    tags: &[&str],
) -> Result<TitleDecision, ErrorCode> {
    if let Some(last) = last_encoded {
        if current != last {
            return Ok(TitleDecision::Conflict);
        }
        let Some(raw) = raw else {
            return Ok(TitleDecision::Conflict);
        };
        return written(raw, encode_title(raw, tags)?, current);
    }
    written(current, encode_title(current, tags)?, current)
}

/// `last_encoded_title` after a receipt whose title matched this plan.
/// Restore stores `raw`, so a cache that still shows the encoded title conflicts
/// instead of being encoded a second time.
pub fn last_title_after_receipt(restore: bool, raw: &str, encoded: &str) -> String {
    if restore {
        raw.to_owned()
    } else {
        encoded.to_owned()
    }
}

/// Restore `raw` only when the current title still equals the title this app wrote.
pub fn decide_restore(
    current: &str,
    raw: Option<&str>,
    last_encoded: Option<&str>,
) -> TitleDecision {
    let (Some(raw), Some(last)) = (raw, last_encoded) else {
        return TitleDecision::Unchanged;
    };
    if current != last {
        return TitleDecision::Conflict;
    }
    if current == raw {
        return TitleDecision::Unchanged;
    }
    TitleDecision::Write {
        raw: raw.to_owned(),
        title: raw.to_owned(),
    }
}

fn written(raw: &str, encoded: String, current: &str) -> Result<TitleDecision, ErrorCode> {
    if encoded == current {
        Ok(TitleDecision::Unchanged)
    } else {
        Ok(TitleDecision::Write {
            raw: raw.to_owned(),
            title: encoded,
        })
    }
}

fn nfc(value: &str) -> String {
    value.nfc().collect()
}

fn escape(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch == '\\' || ch == '|' {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests;
