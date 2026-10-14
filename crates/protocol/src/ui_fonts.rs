//! Desktop-only, read-only installed font metadata. No paths or font bytes cross IPC.
use schemars::JsonSchema;
use serde::{Deserialize, Deserializer, Serialize};

pub const MAX_FONT_FAMILIES: usize = 10_000;
pub const MAX_FONT_NAME_SCALARS: usize = 256;

pub fn valid_font_name(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_FONT_NAME_SCALARS
        && !value.chars().any(char::is_control)
}

fn deserialize_font_name<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let value = String::deserialize(deserializer)?;
    if !valid_font_name(&value) {
        return Err(serde::de::Error::custom("invalid font name"));
    }
    Ok(value)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstalledFontFamily {
    #[serde(deserialize_with = "deserialize_font_name")]
    #[schemars(
        length(min = 1, max = 256),
        regex(pattern = r"^[^\u0000-\u001F\u007F-\u009F\uD800-\uDFFF]+$")
    )]
    pub family: String,
    #[serde(deserialize_with = "deserialize_font_name")]
    #[schemars(
        length(min = 1, max = 256),
        regex(pattern = r"^[^\u0000-\u001F\u007F-\u009F\uD800-\uDFFF]+$")
    )]
    pub display_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FontCatalogUnavailableReason {
    UnsupportedPlatform,
    EnumerationFailed,
    CatalogLimit,
}

fn deserialize_families<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<InstalledFontFamily>, D::Error> {
    let families = Vec::<InstalledFontFamily>::deserialize(deserializer)?;
    if families.len() > MAX_FONT_FAMILIES {
        return Err(serde::de::Error::custom("font catalog limit"));
    }
    Ok(families)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum InstalledFontCatalog {
    Ready {
        #[serde(deserialize_with = "deserialize_families")]
        #[schemars(length(max = 10000))]
        families: Vec<InstalledFontFamily>,
    },
    Unavailable {
        reason: FontCatalogUnavailableReason,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn font_metadata_rejects_private_fields_and_unsafe_names() {
        let ready = json!({"status":"ready","families":[{"family":"Microsoft YaHei", "displayName":"微软雅黑"}]});
        let catalog: InstalledFontCatalog = serde_json::from_value(ready.clone()).unwrap();
        assert_eq!(serde_json::to_value(catalog).unwrap(), ready);
        for name in [
            String::new(),
            "x\n".into(),
            "x\u{85}".into(),
            "x".repeat(257),
        ] {
            assert!(
                serde_json::from_value::<InstalledFontFamily>(
                    json!({"family":name,"displayName":"Font"})
                )
                .is_err()
            );
        }
        assert!(valid_font_name(&"𠮷".repeat(256)));
        assert!(!valid_font_name(&"𠮷".repeat(257)));
        for field in ["path", "bytes", "url", "file"] {
            let mut extra = ready.clone();
            extra["families"][0][field] = json!("private");
            assert!(serde_json::from_value::<InstalledFontCatalog>(extra).is_err());
        }
    }

    #[test]
    fn font_catalog_bounds_and_failure_states_are_exact() {
        let font = json!({"family":"Font","displayName":"Font"});
        assert!(
            serde_json::from_value::<InstalledFontCatalog>(
                json!({"status":"ready","families":vec![font; 10001]})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<InstalledFontCatalog>(json!({"status":"ready","families":[]}))
                .is_ok()
        );
        for reason in [
            "unsupported_platform",
            "enumeration_failed",
            "catalog_limit",
        ] {
            assert!(
                serde_json::from_value::<InstalledFontCatalog>(
                    json!({"status":"unavailable","reason":reason})
                )
                .is_ok()
            );
        }
        for value in [
            json!({"status":"unavailable","reason":"raw OS error"}),
            json!({"status":"unavailable","reason":"enumeration_failed","path":"private"}),
            json!({"status":"ready","families":[],"reason":"catalog_limit"}),
        ] {
            assert!(serde_json::from_value::<InstalledFontCatalog>(value).is_err());
        }
    }
}
