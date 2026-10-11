//! Content preview DTO. The summary is a page description or a text excerpt, not a model summary.
use crate::{Counter, Id, RequiredNullable};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PreviewStatus {
    Ready,
    Cached,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SummarySource {
    Description,
    Excerpt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PreviewFailure {
    SchemeDenied,
    AddressDenied,
    UserinfoDenied,
    RedirectDenied,
    RebindDenied,
    BodyTooLarge,
    TimedOut,
    Unreachable,
    NotHtml,
    InvalidResponse,
    LoginRequired,
    NotFound,
    NoUrl,
}

impl PreviewFailure {
    pub fn message(self) -> &'static str {
        match self {
            Self::SchemeDenied => "不支持的地址协议",
            Self::AddressDenied => "地址指向受限网络",
            Self::UserinfoDenied => "地址包含登录信息",
            Self::RedirectDenied => "重定向指向受限地址",
            Self::RebindDenied => "域名解析结果发生变化",
            Self::BodyTooLarge => "页面超过 5 MiB",
            Self::TimedOut => "抓取超过 10 秒",
            Self::Unreachable => "无法连接页面",
            Self::NotHtml => "页面不是 HTML",
            Self::InvalidResponse => "页面响应无效",
            Self::LoginRequired => "页面需要登录",
            Self::NotFound => "页面不存在",
            Self::NoUrl => "此条目没有可预览的网页地址",
        }
    }

    pub fn image_message(self) -> &'static str {
        match self {
            Self::SchemeDenied => "来源图片协议不受支持",
            Self::AddressDenied => "来源图片指向受限网络",
            Self::UserinfoDenied => "来源图片地址包含登录信息",
            Self::RedirectDenied => "来源图片重定向指向受限地址",
            Self::RebindDenied => "来源图片的域名解析结果发生变化",
            Self::BodyTooLarge => "来源图片超过 2 MiB",
            Self::TimedOut => "来源图片抓取超过 10 秒",
            Self::Unreachable => "无法连接来源图片",
            Self::NotHtml | Self::InvalidResponse | Self::NoUrl => "来源图片响应无效",
            Self::LoginRequired => "来源图片需要登录",
            Self::NotFound => "来源图片不存在",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum ImageMediaType {
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/jpeg")]
    Jpeg,
    #[serde(rename = "image/gif")]
    Gif,
    #[serde(rename = "image/webp")]
    Webp,
}

impl ImageMediaType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewImage {
    pub media_type: ImageMediaType,
    #[schemars(length(max = 2800000))]
    pub data_base64: String,
    #[schemars(length(max = 32))]
    pub source_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentPreview {
    pub request_id: Id,
    pub profile_id: Id,
    pub chrome_id: Id,
    pub bookmark_id: Id,
    pub status: PreviewStatus,
    #[schemars(schema_with = "title_schema")]
    pub title: RequiredNullable<String>,
    #[schemars(schema_with = "summary_schema")]
    pub summary: RequiredNullable<String>,
    pub summary_source: RequiredNullable<SummarySource>,
    pub image: RequiredNullable<PreviewImage>,
    pub image_failure: RequiredNullable<PreviewFailure>,
    #[schemars(schema_with = "message_schema")]
    pub image_failure_message: RequiredNullable<String>,
    pub fetched_at: RequiredNullable<Counter>,
    #[schemars(schema_with = "message_schema")]
    pub cache_label: RequiredNullable<String>,
    pub failure: RequiredNullable<PreviewFailure>,
    #[schemars(schema_with = "message_schema")]
    pub failure_message: RequiredNullable<String>,
}

fn nullable_text(max: usize) -> schemars::Schema {
    schemars::Schema::try_from(serde_json::json!({
        "description": "A required JSON field whose value can be null. Unlike Option, absence is rejected.",
        "type": ["string", "null"],
        "maxLength": max
    }))
    .expect("nullable text schema")
}

fn title_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    nullable_text(300)
}

fn summary_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    nullable_text(1000)
}

fn message_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    nullable_text(80)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_message_names_the_ten_second_budget() {
        assert_eq!(PreviewFailure::TimedOut.message(), "抓取超过 10 秒");
        assert!(PreviewFailure::TimedOut.image_message().contains("10 秒"));
    }
}
