#[cfg(not(windows))]
use markbridge_protocol::FontCatalogUnavailableReason;
use markbridge_protocol::InstalledFontCatalog;

/// Called only on a blocking worker after the main-window trust check.
pub fn installed_fonts() -> InstalledFontCatalog {
    #[cfg(windows)]
    {
        match windows_catalog::enumerate() {
            Ok(families) => InstalledFontCatalog::Ready { families },
            Err(reason) => InstalledFontCatalog::Unavailable { reason },
        }
    }
    #[cfg(not(windows))]
    {
        InstalledFontCatalog::Unavailable {
            reason: FontCatalogUnavailableReason::UnsupportedPlatform,
        }
    }
}

#[cfg(windows)]
mod windows_catalog {
    use markbridge_protocol::{
        FontCatalogUnavailableReason as Failure, InstalledFontFamily, MAX_FONT_FAMILIES,
        MAX_FONT_NAME_SCALARS, valid_font_name,
    };
    use std::cmp::Ordering;
    use windows::Win32::Globalization::{
        CSTR_EQUAL, CSTR_GREATER_THAN, CSTR_LESS_THAN, CompareStringOrdinal,
    };
    use windows::Win32::Graphics::DirectWrite::{
        DWRITE_FACTORY_TYPE_SHARED, DWriteCreateFactory, IDWriteFactory3, IDWriteLocalizedStrings,
    };
    use windows::core::{BOOL, PCWSTR, w};

    pub(super) fn enumerate() -> Result<Vec<InstalledFontFamily>, Failure> {
        deduplicate(local_families()?)
    }

    pub(super) fn local_families() -> Result<Vec<InstalledFontFamily>, Failure> {
        // DirectWrite creates its own COM objects; they are created, used and dropped on
        // this worker. No COM object, loader, file, or font data leaves the worker.
        let families = unsafe {
            let factory: IDWriteFactory3 = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)
                .map_err(|_| Failure::EnumerationFailed)?;
            let mut collection = None;
            // false excludes downloadable fonts; true refreshes installed fonts.
            factory
                .GetSystemFontCollection(false, &mut collection, true)
                .map_err(|_| Failure::EnumerationFailed)?;
            let collection = collection.ok_or(Failure::EnumerationFailed)?;
            let count = collection.GetFontFamilyCount() as usize;
            if count > MAX_FONT_FAMILIES {
                return Err(Failure::CatalogLimit);
            }
            let mut families = Vec::with_capacity(count);
            for index in 0..count {
                let names = collection
                    .GetFontFamily(index as u32)
                    .and_then(|family| family.GetFamilyNames())
                    .map_err(|_| Failure::EnumerationFailed)?;
                if names.GetCount() == 0 {
                    return Err(Failure::EnumerationFailed);
                }
                let canonical_index = locale_index(&names, w!("en-US"))?.unwrap_or(0);
                let display_index = locale_index(&names, w!("zh-CN"))?.unwrap_or(canonical_index);
                families.push(InstalledFontFamily {
                    family: read_name(&names, canonical_index)?,
                    display_name: read_name(&names, display_index)?,
                });
            }
            families
        };
        Ok(families)
    }

    unsafe fn locale_index(
        names: &IDWriteLocalizedStrings,
        locale: PCWSTR,
    ) -> Result<Option<u32>, Failure> {
        let mut index = 0;
        let mut exists = BOOL::default();
        // The locale is a static NUL-terminated string and out pointers are valid.
        unsafe { names.FindLocaleName(locale, &mut index, &mut exists) }
            .map_err(|_| Failure::EnumerationFailed)?;
        Ok(exists.as_bool().then_some(index))
    }

    pub(super) unsafe fn read_name(
        names: &IDWriteLocalizedStrings,
        index: u32,
    ) -> Result<String, Failure> {
        let length = unsafe { names.GetStringLength(index) }
            .map_err(|_| Failure::EnumerationFailed)? as usize;
        // UTF-16 can use two code units per scalar. Bound allocation before reading.
        if length > MAX_FONT_NAME_SCALARS * 2 {
            return Err(Failure::CatalogLimit);
        }
        let mut buffer = vec![0; length + 1];
        unsafe { names.GetString(index, &mut buffer) }.map_err(|_| Failure::EnumerationFailed)?;
        let value =
            String::from_utf16(&buffer[..length]).map_err(|_| Failure::EnumerationFailed)?;
        if value.chars().count() > MAX_FONT_NAME_SCALARS {
            return Err(Failure::CatalogLimit);
        }
        if !valid_font_name(&value) {
            return Err(Failure::EnumerationFailed);
        }
        Ok(value)
    }

    pub(super) fn family_order(left: &str, right: &str) -> Result<Ordering, Failure> {
        let left: Vec<u16> = left.encode_utf16().collect();
        let right: Vec<u16> = right.encode_utf16().collect();
        // Compare the bounded UTF-16 slices with Windows ordinal case-insensitivity,
        // avoiding locale-dependent or expanding Unicode case conversions.
        match unsafe { CompareStringOrdinal(&left, &right, true) } {
            CSTR_LESS_THAN => Ok(Ordering::Less),
            CSTR_EQUAL => Ok(Ordering::Equal),
            CSTR_GREATER_THAN => Ok(Ordering::Greater),
            _ => Err(Failure::EnumerationFailed),
        }
    }

    pub(super) fn deduplicate(
        mut families: Vec<InstalledFontFamily>,
    ) -> Result<Vec<InstalledFontFamily>, Failure> {
        let mut failed = false;
        families.sort_by(|left, right| {
            family_order(&left.family, &right.family).unwrap_or_else(|_| {
                failed = true;
                Ordering::Equal
            })
        });
        families.dedup_by(|left, right| {
            family_order(&left.family, &right.family).map_or_else(
                |_| {
                    failed = true;
                    false
                },
                |ordering| ordering == Ordering::Equal,
            )
        });
        if failed {
            Err(Failure::EnumerationFailed)
        } else {
            Ok(families)
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use markbridge_protocol::{InstalledFontFamily, valid_font_name};

    #[test]
    fn family_deduplication_uses_windows_ordinal_casing() {
        let names = [
            "Segoe UI",
            "segoe ui",
            "微软雅黑",
            "微软雅黑",
            "STRASSE",
            "Straße",
        ];
        let families = names.map(|name| InstalledFontFamily {
            family: name.into(),
            display_name: name.into(),
        });
        let deduplicated = windows_catalog::deduplicate(families.into()).unwrap();
        assert_eq!(deduplicated.len(), 4);
        assert!(deduplicated.iter().any(|font| font.family == "Straße"));
    }

    #[test]
    #[ignore = "explicit local Windows font enumeration smoke; runtime-dependent"]
    fn installed_font_catalog_native_smoke() {
        let InstalledFontCatalog::Ready { families } = installed_fonts() else {
            panic!("local Windows font enumeration unavailable");
        };
        assert!(!families.is_empty());
        assert!(
            families
                .iter()
                .all(|font| valid_font_name(&font.family) && valid_font_name(&font.display_name))
        );
        let samples: Vec<_> = [
            "Arial",
            "Microsoft YaHei",
            "Microsoft YaHei UI",
            "SimSun",
            "Segoe UI",
        ]
        .iter()
        .filter_map(|name| families.iter().find(|font| font.family == *name))
        .collect();
        assert!(samples.iter().any(|font| font.family == "Arial"));
        assert!(samples.iter().any(|font| font.family == "Microsoft YaHei"));
        // Explicit smoke evidence prints only the selected cross-check samples, never a catalog.
        println!(
            "installed_font_count={} selected_samples={samples:?}",
            families.len()
        );
    }

    #[test]
    #[ignore = "explicit Windows DirectWrite/GDI census comparison; requires PowerShell"]
    fn font_catalog_gdi_census() {
        let raw = windows_catalog::local_families().unwrap();
        let raw_count = raw.len();
        let families = windows_catalog::deduplicate(raw).unwrap();
        let script = r#"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Drawing; $fonts = [System.Drawing.Text.InstalledFontCollection]::new(); try { ConvertTo-Json -Compress -InputObject @($fonts.Families | ForEach-Object { $_.Name }) } finally { $fonts.Dispose() }"#;
        let output = std::process::Command::new("pwsh")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
            .unwrap();
        assert!(output.status.success(), "GDI census failed");
        let gdi: Vec<String> = serde_json::from_slice(&output.stdout).unwrap();
        let gdi_count = gdi.len();
        let gdi = windows_catalog::deduplicate(
            gdi.into_iter()
                .map(|name| InstalledFontFamily {
                    family: name.clone(),
                    display_name: name,
                })
                .collect(),
        )
        .unwrap();
        let only_gdi: Vec<_> = gdi
            .iter()
            .filter(|gdi| {
                !families.iter().any(|font| {
                    windows_catalog::family_order(&gdi.family, &font.family)
                        .unwrap()
                        .is_eq()
                        || windows_catalog::family_order(&gdi.family, &font.display_name)
                            .unwrap()
                            .is_eq()
                })
            })
            .collect();
        println!(
            "DirectWrite raw={raw_count} dedup={} GDI raw={gdi_count} dedup={} unmatched={} first_unmatched={:?}",
            families.len(),
            gdi.len(),
            only_gdi.len(),
            only_gdi
                .iter()
                .take(12)
                .map(|font| &font.family)
                .collect::<Vec<_>>()
        );
        // Diagnose family grouping using only metadata already exposed by DirectWrite.
        use windows::Win32::Graphics::DirectWrite::{
            DWRITE_FACTORY_TYPE_SHARED, DWRITE_INFORMATIONAL_STRING_WIN32_FAMILY_NAMES,
            DWriteCreateFactory, IDWriteFactory3,
        };
        use windows::core::BOOL;
        let aliases = unsafe {
            let factory: IDWriteFactory3 = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).unwrap();
            let mut collection = None;
            factory
                .GetSystemFontCollection(false, &mut collection, true)
                .unwrap();
            let collection = collection.unwrap();
            let mut aliases = Vec::new();
            for index in 0..collection.GetFontFamilyCount() {
                let family = collection.GetFontFamily(index).unwrap();
                let family_names = family.GetFamilyNames().unwrap();
                let canonical = windows_catalog::read_name(&family_names, 0).unwrap();
                for font_index in 0..family.GetFontCount() {
                    let font = family.GetFont(font_index).unwrap();
                    let mut names = None;
                    let mut exists = BOOL::default();
                    font.GetInformationalStrings(
                        DWRITE_INFORMATIONAL_STRING_WIN32_FAMILY_NAMES,
                        &mut names,
                        &mut exists,
                    )
                    .unwrap();
                    if exists.as_bool() {
                        let names = names.unwrap();
                        for name_index in 0..names.GetCount() {
                            aliases.push((
                                windows_catalog::read_name(&names, name_index).unwrap(),
                                canonical.clone(),
                            ));
                        }
                    }
                }
            }
            aliases
        };
        let mut matched = 0;
        let unmatched_count = only_gdi.len();
        let mut mapping_samples = Vec::new();
        let mut unresolved_samples = Vec::new();
        for font in only_gdi {
            let alias = aliases.iter().find(|(name, _)| {
                let truncated =
                    String::from_utf16_lossy(&name.encode_utf16().take(31).collect::<Vec<_>>());
                windows_catalog::family_order(&font.family, name)
                    .unwrap()
                    .is_eq()
                    || windows_catalog::family_order(&font.family, &truncated)
                        .unwrap()
                        .is_eq()
            });
            if let Some((alias, family)) = alias {
                matched += 1;
                if mapping_samples.len() < 6 {
                    mapping_samples.push((&font.family, alias, family));
                }
            } else if unresolved_samples.len() < 12 {
                unresolved_samples.push(&font.family);
            }
        }
        println!(
            "GDI variant/31-unit aliases matched={matched} bounded_mappings={mapping_samples:?} unresolved_samples={unresolved_samples:?}"
        );
        assert_eq!(matched, unmatched_count, "unresolved GDI font metadata");
    }
}
