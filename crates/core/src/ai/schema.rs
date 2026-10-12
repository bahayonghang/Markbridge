//! Local checks for untrusted model JSON. Unknown fields and overlong values are rejected.
use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Validated {
    pub title: String,
    pub tags: Vec<String>,
    pub summary: Option<String>,
    pub suggested_folder: Option<String>,
    pub evidence: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawSuggestion {
    title: String,
    tags: Vec<String>,
    summary: Option<String>,
    suggested_folder: Option<String>,
    evidence: Option<String>,
}

pub(crate) fn parse_model_text(text: &str) -> Result<Validated, ()> {
    let stripped = strip_fence(text.trim());
    let raw: RawSuggestion = serde_json::from_str(stripped).map_err(|_| ())?;
    check(
        raw.title,
        raw.tags,
        raw.summary,
        raw.suggested_folder,
        raw.evidence,
    )
}

pub(crate) fn parse_provider_body(body: &str) -> Result<Validated, ()> {
    if let Ok(valid) = parse_model_text(body) {
        return Ok(valid);
    }
    parse_model_text(&provider_content(body)?)
}

pub(crate) fn provider_content(body: &str) -> Result<String, ()> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|_| ())?;
    let content = value
        .pointer("/message/content")
        .or_else(|| value.pointer("/choices/0/message/content"));
    let Some(content) = content else {
        return if value.is_object() {
            Ok(body.to_owned())
        } else {
            Err(())
        };
    };
    match content {
        serde_json::Value::String(text) => Ok(text.clone()),
        serde_json::Value::Object(_) | serde_json::Value::Array(_) => Ok(content.to_string()),
        _ => Err(()),
    }
}

pub(crate) fn validate_edit(
    title: &str,
    tags: &[String],
    summary: Option<&str>,
) -> Result<Validated, ()> {
    check(
        title.to_owned(),
        tags.to_vec(),
        summary.map(str::to_owned),
        None,
        None,
    )
}

fn check(
    title: String,
    tags: Vec<String>,
    summary: Option<String>,
    folder: Option<String>,
    evidence: Option<String>,
) -> Result<Validated, ()> {
    let title = required_text(&title, 60, false)?;
    if tags.len() > 3 {
        return Err(());
    }
    let mut clean_tags = Vec::with_capacity(tags.len());
    for tag in tags {
        let tag = required_text(&tag, 8, false)?;
        if tag.is_empty() || tag.contains('|') {
            return Err(());
        }
        clean_tags.push(tag);
    }
    let summary = match summary {
        Some(value) if value.is_empty() => None,
        Some(value) => Some(required_text(&value, 1_000, true)?),
        None => None,
    };
    let suggested_folder = match folder {
        Some(value) if value.trim().is_empty() => None,
        Some(value) => Some(required_text(value.trim(), 60, false)?),
        None => None,
    };
    let evidence = match evidence {
        Some(value) if value.trim().is_empty() => None,
        Some(value) => Some(required_text(value.trim(), 200, true)?),
        None => None,
    };
    Ok(Validated {
        title,
        tags: clean_tags,
        summary,
        suggested_folder,
        evidence,
    })
}

fn required_text(value: &str, max: usize, newlines: bool) -> Result<String, ()> {
    if value.chars().count() > max {
        return Err(());
    }
    if value
        .chars()
        .any(|ch| ch.is_control() && !(newlines && (ch == '\n' || ch == '\t')))
    {
        return Err(());
    }
    Ok(value.to_owned())
}

fn strip_fence(text: &str) -> &str {
    let Some(rest) = text.strip_prefix("```") else {
        return text;
    };
    let rest = rest.strip_prefix("json").unwrap_or(rest).trim_start();
    rest.strip_suffix("```").unwrap_or(rest).trim()
}
