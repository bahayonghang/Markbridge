//! Folder and assignment checks. Model text is untrusted data.
use std::collections::{HashMap, HashSet};

use markbridge_protocol::ErrorCode;
use serde::Deserialize;

use super::record::{AssignRow, FolderRow, ScopeRow};

pub(crate) const SAMPLE_LIMIT: usize = 200;
pub(crate) const BATCH_SIZE: usize = 25;
pub(crate) const CLASS_MAX: usize = 12;
pub(crate) const SCOPE_LIMIT: usize = 900;

pub(crate) fn class_bounds(sampled: usize) -> (usize, usize) {
    if sampled == 0 {
        (0, 0)
    } else if sampled < 8 {
        (1, sampled.min(CLASS_MAX))
    } else {
        (8, CLASS_MAX)
    }
}

pub(crate) fn sample_rows(scope: &[ScopeRow]) -> Vec<ScopeRow> {
    scope.iter().take(SAMPLE_LIMIT).cloned().collect()
}

pub(crate) fn parse_folders(
    text: &str,
    sampled: usize,
    reserved: &HashSet<String>,
) -> Result<Vec<FolderRow>, ErrorCode> {
    let raw: FolderFile =
        serde_json::from_str(strip_fence(text.trim())).map_err(|_| ErrorCode::InvalidAiOutput)?;
    if raw.folders.len() > CLASS_MAX {
        return Err(ErrorCode::InvalidAiOutput);
    }
    let (min, max) = class_bounds(sampled);
    if raw.folders.len() < min || raw.folders.len() > max {
        return Err(ErrorCode::InvalidAiOutput);
    }
    let mut names = HashSet::new();
    for folder in &raw.folders {
        let name = clean_name(&folder.name)?;
        if !names.insert(name) {
            return Err(ErrorCode::InvalidAiOutput);
        }
    }
    let mut rows = Vec::new();
    for (index, folder) in raw.folders.iter().enumerate() {
        let mut number = index + 1;
        let mut folder_id = format!("fld{number}");
        while reserved.contains(&folder_id)
            || rows
                .iter()
                .any(|row: &FolderRow| row.folder_id == folder_id)
        {
            number += 1;
            folder_id = format!("fld{number}");
            if number > CLASS_MAX + reserved.len() + 2 {
                return Err(ErrorCode::InvalidAiOutput);
            }
        }
        rows.push(FolderRow {
            folder_id,
            name: clean_name(&folder.name)?,
            parent_folder_id: None,
            reviewed: false,
        });
    }
    for (index, folder) in raw.folders.iter().enumerate() {
        if let Some(parent) = folder
            .parent
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let parent_index = raw
                .folders
                .iter()
                .position(|item| clean_name(&item.name).ok().as_deref() == Some(parent))
                .ok_or(ErrorCode::InvalidAiOutput)?;
            if parent_index == index {
                return Err(ErrorCode::InvalidTree);
            }
            rows[index].parent_folder_id = Some(rows[parent_index].folder_id.clone());
        }
    }
    accept_folders(&rows, reserved, false)?;
    Ok(rows)
}

pub(crate) fn accept_folders(
    folders: &[FolderRow],
    reserved: &HashSet<String>,
    reviewed: bool,
) -> Result<(), ErrorCode> {
    if folders.is_empty() || folders.len() > CLASS_MAX {
        return Err(ErrorCode::InvalidAiOutput);
    }
    let mut ids = HashSet::new();
    for folder in folders {
        if !ids.insert(folder.folder_id.as_str()) {
            return Err(ErrorCode::InvalidTree);
        }
        if reserved.contains(&folder.folder_id) {
            return Err(ErrorCode::InvalidTree);
        }
        clean_name(&folder.name)?;
        if reviewed && !folder.reviewed {
            return Err(ErrorCode::InvalidMessage);
        }
    }
    let known: HashSet<&str> = folders
        .iter()
        .map(|folder| folder.folder_id.as_str())
        .collect();
    let mut incoming: HashMap<&str, usize> = HashMap::new();
    for folder in folders {
        incoming.entry(folder.folder_id.as_str()).or_insert(0);
        if let Some(parent) = &folder.parent_folder_id {
            if parent == &folder.folder_id || !known.contains(parent.as_str()) {
                return Err(ErrorCode::InvalidTree);
            }
            *incoming.entry(folder.folder_id.as_str()).or_insert(0) += 1;
        }
    }
    let mut seen = 0;
    let mut ready: Vec<&str> = folders
        .iter()
        .filter(|folder| {
            incoming
                .get(folder.folder_id.as_str())
                .copied()
                .unwrap_or(1)
                == 0
        })
        .map(|folder| folder.folder_id.as_str())
        .collect();
    while let Some(id) = ready.pop() {
        seen += 1;
        for folder in folders {
            if folder.parent_folder_id.as_deref() == Some(id) {
                let left = incoming
                    .get_mut(folder.folder_id.as_str())
                    .ok_or(ErrorCode::InvalidTree)?;
                *left = left.saturating_sub(1);
                if *left == 0 {
                    ready.push(folder.folder_id.as_str());
                }
            }
        }
    }
    if seen != folders.len() {
        Err(ErrorCode::InvalidTree)
    } else {
        Ok(())
    }
}

pub(crate) fn parse_batch(
    text: &str,
    batch: &[ScopeRow],
    folders: &[FolderRow],
) -> Result<Vec<AssignRow>, ErrorCode> {
    let raw: AssignFile =
        serde_json::from_str(strip_fence(text.trim())).map_err(|_| ErrorCode::InvalidAiOutput)?;
    if raw.assignments.len() != batch.len() {
        return Err(ErrorCode::InvalidAiOutput);
    }
    let reviewed: HashSet<&str> = folders
        .iter()
        .filter(|folder| folder.reviewed)
        .map(|folder| folder.folder_id.as_str())
        .collect();
    let mut seen = HashSet::new();
    let mut rows = Vec::new();
    for item in &raw.assignments {
        if item.chrome_id != item.cited_input_id || item.folder_id != item.cited_folder_id {
            return Err(ErrorCode::InvalidAiOutput);
        }
        if !seen.insert(item.chrome_id.as_str()) {
            return Err(ErrorCode::InvalidAiOutput);
        }
        let source = batch
            .iter()
            .find(|row| row.chrome_id == item.chrome_id)
            .ok_or(ErrorCode::InvalidAiOutput)?;
        if !reviewed.contains(item.folder_id.as_str()) {
            return Err(ErrorCode::InvalidAiOutput);
        }
        rows.push(AssignRow {
            chrome_id: source.chrome_id.clone(),
            bookmark_id: source.bookmark_id.clone(),
            source_parent_id: source.parent_id.clone(),
            source_label: source.label(),
            target_folder_id: item.folder_id.clone(),
            cited_input_id: item.cited_input_id.clone(),
            cited_folder_id: item.cited_folder_id.clone(),
            rejected: false,
        });
    }
    if rows.len() != batch.len() {
        return Err(ErrorCode::InvalidAiOutput);
    }
    Ok(rows)
}

pub(crate) fn validate_coverage(
    scope: &[ScopeRow],
    folders: &[FolderRow],
    rows: &[AssignRow],
) -> Result<(), ErrorCode> {
    if rows.len() != scope.len() {
        return Err(ErrorCode::InvalidAiOutput);
    }
    let mut seen = HashSet::new();
    let reviewed: HashSet<&str> = folders
        .iter()
        .filter(|folder| folder.reviewed)
        .map(|folder| folder.folder_id.as_str())
        .collect();
    for row in rows {
        if !seen.insert(row.chrome_id.as_str()) {
            return Err(ErrorCode::InvalidAiOutput);
        }
        let source = scope
            .iter()
            .find(|item| item.chrome_id == row.chrome_id)
            .ok_or(ErrorCode::InvalidAiOutput)?;
        if source.bookmark_id != row.bookmark_id
            || row.cited_input_id != row.chrome_id
            || row.cited_folder_id != row.target_folder_id
            || !reviewed.contains(row.target_folder_id.as_str())
        {
            return Err(ErrorCode::InvalidAiOutput);
        }
    }
    if seen.len() != scope.len() {
        Err(ErrorCode::InvalidAiOutput)
    } else {
        Ok(())
    }
}

pub(crate) fn folder_prompt(sample: &[ScopeRow], min: usize, max: usize) -> String {
    let mut lines = vec![format!(
        "Propose between {min} and {max} folders. Data start"
    )];
    for row in sample {
        lines.push(format!(
            "id: {}\ntitle: {}\nurl: {}",
            row.chrome_id,
            clip(&row.title, 80),
            row.url
                .as_deref()
                .map(|value| clip(value, 120))
                .unwrap_or_else(|| "(none)".to_owned())
        ));
    }
    lines.push("Data end".to_owned());
    lines.join("\n")
}

pub(crate) fn assignment_prompt(batch: &[ScopeRow], folders: &[FolderRow]) -> String {
    let mut lines = vec!["Reviewed folders:".to_owned()];
    for folder in folders {
        lines.push(format!(
            "id: {} name: {} parent: {}",
            folder.folder_id,
            folder.name,
            folder.parent_folder_id.as_deref().unwrap_or("(none)")
        ));
    }
    lines.push("Items:".to_owned());
    lines.push("Data start".to_owned());
    for row in batch {
        lines.push(format!(
            "id: {}\ntitle: {}\nurl: {}",
            row.chrome_id,
            clip(&row.title, 80),
            row.url
                .as_deref()
                .map(|value| clip(value, 120))
                .unwrap_or_else(|| "(none)".to_owned())
        ));
    }
    lines.push("Data end".to_owned());
    lines.join("\n")
}

pub(crate) fn clean_name(value: &str) -> Result<String, ErrorCode> {
    let name = value.trim();
    let length = name.chars().count();
    if !(1..=60).contains(&length) || name.chars().any(char::is_control) {
        return Err(ErrorCode::InvalidAiOutput);
    }
    Ok(name.to_owned())
}

fn clip(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

fn strip_fence(text: &str) -> &str {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    let rest = rest
        .strip_prefix("json")
        .unwrap_or(rest)
        .trim_start_matches('\n');
    rest.strip_suffix("```").unwrap_or(rest).trim()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FolderFile {
    folders: Vec<RawFolder>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawFolder {
    name: String,
    parent: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssignFile {
    assignments: Vec<RawAssign>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawAssign {
    chrome_id: String,
    folder_id: String,
    cited_input_id: String,
    cited_folder_id: String,
}
