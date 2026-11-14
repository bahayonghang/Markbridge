//! Headless JSON CLI for operating Markbridge's isolated `local-skills` SQLite bookmark library.
//! Enforces daily-database write protection (`--allow-daily-db`) and redaction-safe error output.
use markbridge_core::{
    storage::{
        LOCAL_SKILLS_DISPLAY_NAME, LOCAL_SKILLS_PROFILE_ID, LOCAL_SKILLS_ROOT_ID,
        LocalSkillsStatus, SCHEMA_VERSION, Storage,
    },
    tags as tag_rules,
};
use markbridge_protocol::{
    Counter, EditDocumentKind, ErrorCode, FolderScope, Id, LibraryQuery, LibraryQueryPage,
    RequiredNullable, SourceEpoch, TagCatalog, TagCommand, Title,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    env,
    path::{Path, PathBuf},
    process::ExitCode,
};

const DB_FILENAME: &str = "markbridge.sqlite";
const DAILY_BUNDLE_ID: &str = "com.markbridge.desktop";

#[derive(Debug, Clone)]
struct GlobalOptions {
    app_data: PathBuf,
    allow_daily_db: bool,
    profile_id: String,
}

#[derive(Debug, Clone)]
enum Command {
    Help,
    Status,
    Init,
    Tree {
        folder_id: Option<String>,
        depth: Option<u64>,
    },
    List {
        folder_id: Option<String>,
        scope: FolderScope,
        offset: u64,
        limit: u64,
    },
    Search {
        query: String,
        folder_id: Option<String>,
        scope: FolderScope,
        tags: Vec<String>,
        include_summary: bool,
        include_note: bool,
        offset: u64,
        limit: u64,
    },
    Get {
        id: String,
    },
    Mkdir {
        parent_id: Option<String>,
        title: String,
        position: Option<u64>,
    },
    Add {
        parent_id: Option<String>,
        title: String,
        url: String,
        position: Option<u64>,
        tags: Vec<String>,
        note: Option<String>,
        summary: Option<String>,
    },
    Update {
        id: String,
        title: Option<String>,
        url: Option<String>,
    },
    Move {
        id: String,
        parent_id: String,
        position: Option<u64>,
    },
    Delete {
        id: String,
        recursive: bool,
        backup: Option<PathBuf>,
    },
    Tag(TagAction),
    Note {
        id: String,
        note: String,
    },
    Summary {
        id: String,
        summary: Option<String>,
    },
    Backup {
        output: PathBuf,
    },
    Export {
        format: EditDocumentKind,
        output: PathBuf,
        overwrite: bool,
    },
}

#[derive(Debug, Clone)]
enum TagAction {
    List {
        chrome_ids: Vec<String>,
        filter: Option<String>,
    },
    Add {
        chrome_ids: Vec<String>,
        name: String,
    },
    Remove {
        chrome_ids: Vec<String>,
        tag_id: Option<String>,
        name: Option<String>,
    },
    Rename {
        tag_id: Option<String>,
        from_name: Option<String>,
        name: String,
    },
    Delete {
        tag_id: Option<String>,
        name: Option<String>,
    },
}

impl Command {
    fn is_write(&self) -> bool {
        match self {
            Self::Help
            | Self::Status
            | Self::Tree { .. }
            | Self::List { .. }
            | Self::Search { .. }
            | Self::Get { .. }
            | Self::Export { .. } => false,
            Self::Tag(TagAction::List { .. }) => false,
            Self::Init
            | Self::Mkdir { .. }
            | Self::Add { .. }
            | Self::Update { .. }
            | Self::Move { .. }
            | Self::Delete { .. }
            | Self::Tag(_)
            | Self::Note { .. }
            | Self::Summary { .. }
            | Self::Backup { .. } => true,
        }
    }
}

#[derive(Debug)]
struct CliError {
    code: ErrorCode,
    message: &'static str,
}

impl CliError {
    const fn new(code: ErrorCode, message: &'static str) -> Self {
        Self { code, message }
    }

    fn from_code(code: ErrorCode) -> Self {
        let message = match code {
            ErrorCode::InvalidMessage => {
                "Invalid argument, identifier, title, URL, or tag parameter"
            }
            ErrorCode::LimitExceeded => "Requested limit or capacity exceeded",
            ErrorCode::InvalidTree => {
                "Target parent folder is missing, not a folder, or forms a cycle"
            }
            ErrorCode::Unpaired => "Local skills bookmark space is not initialized yet",
            ErrorCode::ReadOnly => "Operation is read-only or blocked by safety policy",
            ErrorCode::WrongProfile => {
                "Local skill CLI can only access or mutate the local-skills space"
            }
            ErrorCode::ProtectedNode => {
                "Protected root folder skills-root cannot be modified, moved, or deleted"
            }
            ErrorCode::StorageError => "SQLite storage operation failed",
            ErrorCode::StorageNewerSchema => {
                "Database schema version is newer than this binary supports"
            }
            ErrorCode::MigrationFailed => "Database schema migration failed",
            ErrorCode::Conflict => {
                "Operation conflicts with current state (non-empty folder or existing target)"
            }
            _ => "Command failed",
        };
        Self { code, message }
    }

    fn exit_code(&self) -> u8 {
        match self.code {
            ErrorCode::StorageError
            | ErrorCode::StorageNewerSchema
            | ErrorCode::MigrationFailed => 1,
            _ => 2,
        }
    }
}

impl From<ErrorCode> for CliError {
    fn from(code: ErrorCode) -> Self {
        Self::from_code(code)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEnvelope {
    ok: bool,
    error_code: ErrorCode,
    message: &'static str,
}

fn default_daily_app_data_dir() -> Result<PathBuf, CliError> {
    if cfg!(windows) {
        let appdata = env::var_os("APPDATA").ok_or_else(|| {
            CliError::new(
                ErrorCode::PathUnavailable,
                "APPDATA environment variable is unavailable; pass --app-data <ABS_DIR>",
            )
        })?;
        Ok(PathBuf::from(appdata).join(DAILY_BUNDLE_ID))
    } else if cfg!(target_os = "macos") {
        let home = env::var_os("HOME").ok_or_else(|| {
            CliError::new(
                ErrorCode::PathUnavailable,
                "HOME environment variable is unavailable; pass --app-data <ABS_DIR>",
            )
        })?;
        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(DAILY_BUNDLE_ID))
    } else {
        if let Some(xdg) = env::var_os("XDG_DATA_HOME")
            && !xdg.is_empty()
        {
            return Ok(PathBuf::from(xdg).join(DAILY_BUNDLE_ID));
        }
        let home = env::var_os("HOME").ok_or_else(|| {
            CliError::new(
                ErrorCode::PathUnavailable,
                "HOME environment variable is unavailable; pass --app-data <ABS_DIR>",
            )
        })?;
        Ok(PathBuf::from(home)
            .join(".local")
            .join("share")
            .join(DAILY_BUNDLE_ID))
    }
}

fn is_daily_database_path(path: &Path) -> bool {
    path.to_string_lossy()
        .to_ascii_lowercase()
        .contains(DAILY_BUNDLE_ID)
}

fn require_absolute_path(raw: &str, err_msg: &'static str) -> Result<PathBuf, CliError> {
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(CliError::new(ErrorCode::InvalidMessage, err_msg));
    }
    Ok(path)
}

fn parse_u64_arg(raw: &str) -> Result<u64, CliError> {
    raw.parse::<u64>().map_err(|_| {
        CliError::new(
            ErrorCode::InvalidMessage,
            "Numeric option must be a non-negative integer",
        )
    })
}

fn parse_scope(raw: &str) -> Result<FolderScope, CliError> {
    match raw {
        "all" => Ok(FolderScope::All),
        "children" => Ok(FolderScope::Children),
        "subtree" => Ok(FolderScope::Subtree),
        _ => Err(CliError::new(
            ErrorCode::InvalidMessage,
            "--scope must be one of: all, children, subtree",
        )),
    }
}

fn split_flag(arg: &str) -> (&str, Option<&str>) {
    if let Some((flag, val)) = arg.split_once('=')
        && flag.starts_with("--")
    {
        (flag, Some(val))
    } else {
        (arg, None)
    }
}

fn next_val<'a>(
    inline: Option<&'a str>,
    iter: &mut std::iter::Peekable<std::slice::Iter<'a, String>>,
) -> Result<String, CliError> {
    if let Some(val) = inline {
        return Ok(val.to_owned());
    }
    iter.next().cloned().ok_or_else(|| {
        CliError::new(
            ErrorCode::InvalidMessage,
            "Missing value for command-line option",
        )
    })
}

fn parse_cli(
    raw_args: &[String],
    env_app_data: Option<String>,
) -> Result<(GlobalOptions, Command), CliError> {
    let mut app_data_arg: Option<String> = None;
    let mut allow_daily_db = false;
    let mut profile_id = LOCAL_SKILLS_PROFILE_ID.to_owned();
    let mut remaining = Vec::new();

    let mut iter = raw_args.iter().peekable();
    while let Some(arg) = iter.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--app-data" => {
                app_data_arg = Some(next_val(inline, &mut iter)?);
            }
            "--allow-daily-db" => {
                if inline.is_some() {
                    return Err(CliError::new(
                        ErrorCode::InvalidMessage,
                        "--allow-daily-db does not take a value",
                    ));
                }
                allow_daily_db = true;
            }
            "--profile" => {
                profile_id = next_val(inline, &mut iter)?;
            }
            _ => remaining.push(arg.clone()),
        }
    }

    let app_data = if let Some(explicit) = app_data_arg {
        require_absolute_path(&explicit, "--app-data must be an absolute directory path")?
    } else if let Some(from_env) = env_app_data.filter(|val| !val.trim().is_empty()) {
        require_absolute_path(
            &from_env,
            "MARKBRIDGE_APP_DATA must be an absolute directory path",
        )?
    } else {
        default_daily_app_data_dir()?
    };

    let globals = GlobalOptions {
        app_data,
        allow_daily_db,
        profile_id,
    };

    if remaining.is_empty()
        || remaining
            .first()
            .is_some_and(|first| matches!(first.as_str(), "-h" | "--help" | "help"))
    {
        return Ok((globals, Command::Help));
    }

    let sub = remaining[0].as_str();
    let sub_args = &remaining[1..];
    let command = match sub {
        "status" => {
            if !sub_args.is_empty() {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "status takes no positional arguments",
                ));
            }
            Command::Status
        }
        "init" => {
            if !sub_args.is_empty() {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "init takes no positional arguments",
                ));
            }
            Command::Init
        }
        "tree" => parse_tree(sub_args)?,
        "list" => parse_list(sub_args)?,
        "search" => parse_search(sub_args)?,
        "get" => parse_get(sub_args)?,
        "mkdir" => parse_mkdir(sub_args)?,
        "add" => parse_add(sub_args)?,
        "update" => parse_update(sub_args)?,
        "move" => parse_move(sub_args)?,
        "delete" => parse_delete(sub_args)?,
        "tag" => Command::Tag(parse_tag(sub_args)?),
        "note" => parse_note(sub_args)?,
        "summary" => parse_summary(sub_args)?,
        "backup" => parse_backup(sub_args)?,
        "export" => parse_export(sub_args)?,
        _ => {
            return Err(CliError::new(
                ErrorCode::InvalidMessage,
                "Unknown subcommand; run with --help for supported commands",
            ));
        }
    };

    Ok((globals, command))
}

fn parse_tree(args: &[String]) -> Result<Command, CliError> {
    let mut folder_id = None;
    let mut depth = None;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--folder" | "--parent" => folder_id = Some(next_val(inline, &mut it)?),
            "--depth" => depth = Some(parse_u64_arg(&next_val(inline, &mut it)?)?),
            _ if !flag.starts_with('-') && folder_id.is_none() => folder_id = Some(arg.clone()),
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for tree",
                ));
            }
        }
    }
    Ok(Command::Tree { folder_id, depth })
}

fn parse_list(args: &[String]) -> Result<Command, CliError> {
    let mut folder_id = None;
    let mut scope = None;
    let mut offset = 0_u64;
    let mut limit = 100_u64;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--folder" | "--parent" => folder_id = Some(next_val(inline, &mut it)?),
            "--scope" => scope = Some(parse_scope(&next_val(inline, &mut it)?)?),
            "--offset" => offset = parse_u64_arg(&next_val(inline, &mut it)?)?,
            "--limit" => limit = parse_u64_arg(&next_val(inline, &mut it)?)?,
            _ if !flag.starts_with('-') && folder_id.is_none() => folder_id = Some(arg.clone()),
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for list",
                ));
            }
        }
    }
    let resolved_scope = scope.unwrap_or(FolderScope::Children);
    let resolved_folder = match resolved_scope {
        FolderScope::All => None,
        _ => Some(folder_id.unwrap_or_else(|| LOCAL_SKILLS_ROOT_ID.to_owned())),
    };
    Ok(Command::List {
        folder_id: resolved_folder,
        scope: resolved_scope,
        offset,
        limit,
    })
}

fn parse_search(args: &[String]) -> Result<Command, CliError> {
    let mut query: Option<String> = None;
    let mut folder_id = None;
    let mut scope = None;
    let mut tags = Vec::new();
    let mut include_summary = true;
    let mut include_note = true;
    let mut offset = 0_u64;
    let mut limit = 50_u64;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--query" | "-q" => query = Some(next_val(inline, &mut it)?),
            "--folder" => folder_id = Some(next_val(inline, &mut it)?),
            "--scope" => scope = Some(parse_scope(&next_val(inline, &mut it)?)?),
            "--tag" => tags.push(next_val(inline, &mut it)?),
            "--tags" => {
                for item in next_val(inline, &mut it)?.split(',') {
                    let trimmed = item.trim();
                    if !trimmed.is_empty() {
                        tags.push(trimmed.to_owned());
                    }
                }
            }
            "--no-summary" => include_summary = false,
            "--include-summary" => include_summary = true,
            "--no-note" => include_note = false,
            "--include-note" => include_note = true,
            "--offset" => offset = parse_u64_arg(&next_val(inline, &mut it)?)?,
            "--limit" => limit = parse_u64_arg(&next_val(inline, &mut it)?)?,
            _ if !flag.starts_with('-') && query.is_none() => query = Some(arg.clone()),
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for search",
                ));
            }
        }
    }
    let resolved_scope = match (&folder_id, scope) {
        (_, Some(explicit)) => explicit,
        (Some(_), None) => FolderScope::Subtree,
        (None, None) => FolderScope::All,
    };
    if resolved_scope != FolderScope::All && folder_id.is_none() {
        folder_id = Some(LOCAL_SKILLS_ROOT_ID.to_owned());
    }
    if resolved_scope == FolderScope::All {
        folder_id = None;
    }
    Ok(Command::Search {
        query: query.unwrap_or_default(),
        folder_id,
        scope: resolved_scope,
        tags,
        include_summary,
        include_note,
        offset,
        limit,
    })
}

fn parse_get(args: &[String]) -> Result<Command, CliError> {
    let mut id = None;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--id" => id = Some(next_val(inline, &mut it)?),
            _ if !flag.starts_with('-') && id.is_none() => id = Some(arg.clone()),
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for get",
                ));
            }
        }
    }
    let id =
        id.ok_or_else(|| CliError::new(ErrorCode::InvalidMessage, "get requires --id <NODE_ID>"))?;
    Ok(Command::Get { id })
}

fn parse_mkdir(args: &[String]) -> Result<Command, CliError> {
    let mut parent_id = None;
    let mut title = None;
    let mut position = None;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--parent" | "--folder" => parent_id = Some(next_val(inline, &mut it)?),
            "--title" | "--name" => title = Some(next_val(inline, &mut it)?),
            "--position" | "--index" => {
                position = Some(parse_u64_arg(&next_val(inline, &mut it)?)?)
            }
            _ if !flag.starts_with('-') && title.is_none() => title = Some(arg.clone()),
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for mkdir",
                ));
            }
        }
    }
    let title = title.ok_or_else(|| {
        CliError::new(ErrorCode::InvalidMessage, "mkdir requires --title <TITLE>")
    })?;
    Ok(Command::Mkdir {
        parent_id,
        title,
        position,
    })
}

fn parse_add(args: &[String]) -> Result<Command, CliError> {
    let mut parent_id = None;
    let mut title = None;
    let mut url = None;
    let mut position = None;
    let mut tags = Vec::new();
    let mut note = None;
    let mut summary = None;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--parent" | "--folder" => parent_id = Some(next_val(inline, &mut it)?),
            "--title" => title = Some(next_val(inline, &mut it)?),
            "--url" => url = Some(next_val(inline, &mut it)?),
            "--position" | "--index" => {
                position = Some(parse_u64_arg(&next_val(inline, &mut it)?)?)
            }
            "--tag" => tags.push(next_val(inline, &mut it)?),
            "--tags" => {
                for item in next_val(inline, &mut it)?.split(',') {
                    let trimmed = item.trim();
                    if !trimmed.is_empty() {
                        tags.push(trimmed.to_owned());
                    }
                }
            }
            "--note" => note = Some(next_val(inline, &mut it)?),
            "--summary" => summary = Some(next_val(inline, &mut it)?),
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for add",
                ));
            }
        }
    }
    let title = title
        .ok_or_else(|| CliError::new(ErrorCode::InvalidMessage, "add requires --title <TITLE>"))?;
    let url = url
        .ok_or_else(|| CliError::new(ErrorCode::InvalidMessage, "add requires --url <HTTP_URL>"))?;
    Ok(Command::Add {
        parent_id,
        title,
        url,
        position,
        tags,
        note,
        summary,
    })
}

fn parse_update(args: &[String]) -> Result<Command, CliError> {
    let mut id = None;
    let mut title = None;
    let mut url = None;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--id" => id = Some(next_val(inline, &mut it)?),
            "--title" => title = Some(next_val(inline, &mut it)?),
            "--url" => url = Some(next_val(inline, &mut it)?),
            _ if !flag.starts_with('-') && id.is_none() => id = Some(arg.clone()),
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for update",
                ));
            }
        }
    }
    let id = id.ok_or_else(|| {
        CliError::new(ErrorCode::InvalidMessage, "update requires --id <NODE_ID>")
    })?;
    if title.is_none() && url.is_none() {
        return Err(CliError::new(
            ErrorCode::InvalidMessage,
            "update requires at least one of --title or --url",
        ));
    }
    Ok(Command::Update { id, title, url })
}

fn parse_move(args: &[String]) -> Result<Command, CliError> {
    let mut id = None;
    let mut parent_id = None;
    let mut position = None;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--id" => id = Some(next_val(inline, &mut it)?),
            "--parent" | "--to" => parent_id = Some(next_val(inline, &mut it)?),
            "--position" | "--index" => {
                position = Some(parse_u64_arg(&next_val(inline, &mut it)?)?)
            }
            _ if !flag.starts_with('-') && id.is_none() => id = Some(arg.clone()),
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for move",
                ));
            }
        }
    }
    let id =
        id.ok_or_else(|| CliError::new(ErrorCode::InvalidMessage, "move requires --id <NODE_ID>"))?;
    let parent_id = parent_id.ok_or_else(|| {
        CliError::new(
            ErrorCode::InvalidMessage,
            "move requires --parent <FOLDER_ID>",
        )
    })?;
    Ok(Command::Move {
        id,
        parent_id,
        position,
    })
}

fn parse_delete(args: &[String]) -> Result<Command, CliError> {
    let mut id = None;
    let mut recursive = false;
    let mut backup = None;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--id" => id = Some(next_val(inline, &mut it)?),
            "--recursive" | "-r" => {
                if inline.is_some() {
                    return Err(CliError::new(
                        ErrorCode::InvalidMessage,
                        "--recursive does not take a value",
                    ));
                }
                recursive = true;
            }
            "--backup" => {
                let raw = next_val(inline, &mut it)?;
                backup = Some(require_absolute_path(
                    &raw,
                    "--backup must be an absolute file path",
                )?);
            }
            _ if !flag.starts_with('-') && id.is_none() => id = Some(arg.clone()),
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for delete",
                ));
            }
        }
    }
    let id = id.ok_or_else(|| {
        CliError::new(ErrorCode::InvalidMessage, "delete requires --id <NODE_ID>")
    })?;
    Ok(Command::Delete {
        id,
        recursive,
        backup,
    })
}

fn parse_tag(args: &[String]) -> Result<TagAction, CliError> {
    let action = args.first().map(String::as_str).ok_or_else(|| {
        CliError::new(
            ErrorCode::InvalidMessage,
            "tag requires an action: list, add, remove, rename, delete",
        )
    })?;
    let rest = &args[1..];
    match action {
        "list" => {
            let mut chrome_ids = Vec::new();
            let mut filter = None;
            let mut it = rest.iter().peekable();
            while let Some(arg) = it.next() {
                let (flag, inline) = split_flag(arg);
                match flag {
                    "--id" => chrome_ids.push(next_val(inline, &mut it)?),
                    "--filter" | "--tag" => filter = Some(next_val(inline, &mut it)?),
                    _ => {
                        return Err(CliError::new(
                            ErrorCode::InvalidMessage,
                            "Unknown option for tag list",
                        ));
                    }
                }
            }
            Ok(TagAction::List { chrome_ids, filter })
        }
        "add" => {
            let mut chrome_ids = Vec::new();
            let mut name = None;
            let mut it = rest.iter().peekable();
            while let Some(arg) = it.next() {
                let (flag, inline) = split_flag(arg);
                match flag {
                    "--id" => chrome_ids.push(next_val(inline, &mut it)?),
                    "--name" | "--tag" => name = Some(next_val(inline, &mut it)?),
                    _ if !flag.starts_with('-') => {
                        if chrome_ids.is_empty() {
                            chrome_ids.push(arg.clone());
                        } else if name.is_none() {
                            name = Some(arg.clone());
                        } else {
                            return Err(CliError::new(
                                ErrorCode::InvalidMessage,
                                "Unexpected positional argument for tag add",
                            ));
                        }
                    }
                    _ => {
                        return Err(CliError::new(
                            ErrorCode::InvalidMessage,
                            "Unknown option for tag add",
                        ));
                    }
                }
            }
            let name = name.ok_or_else(|| {
                CliError::new(ErrorCode::InvalidMessage, "tag add requires --name <TAG>")
            })?;
            if chrome_ids.is_empty() {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "tag add requires --id <NODE_ID>",
                ));
            }
            Ok(TagAction::Add { chrome_ids, name })
        }
        "remove" => {
            let mut chrome_ids = Vec::new();
            let mut tag_id = None;
            let mut name = None;
            let mut it = rest.iter().peekable();
            while let Some(arg) = it.next() {
                let (flag, inline) = split_flag(arg);
                match flag {
                    "--id" => chrome_ids.push(next_val(inline, &mut it)?),
                    "--tag-id" => tag_id = Some(next_val(inline, &mut it)?),
                    "--name" | "--tag" => name = Some(next_val(inline, &mut it)?),
                    _ if !flag.starts_with('-') => {
                        if chrome_ids.is_empty() {
                            chrome_ids.push(arg.clone());
                        } else if name.is_none() && tag_id.is_none() {
                            name = Some(arg.clone());
                        } else {
                            return Err(CliError::new(
                                ErrorCode::InvalidMessage,
                                "Unexpected positional argument for tag remove",
                            ));
                        }
                    }
                    _ => {
                        return Err(CliError::new(
                            ErrorCode::InvalidMessage,
                            "Unknown option for tag remove",
                        ));
                    }
                }
            }
            if chrome_ids.is_empty() || (tag_id.is_none() && name.is_none()) {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "tag remove requires --id <NODE_ID> and (--tag-id <ID> or --name <TAG>)",
                ));
            }
            Ok(TagAction::Remove {
                chrome_ids,
                tag_id,
                name,
            })
        }
        "rename" => {
            let mut tag_id = None;
            let mut from_name = None;
            let mut name = None;
            let mut it = rest.iter().peekable();
            while let Some(arg) = it.next() {
                let (flag, inline) = split_flag(arg);
                match flag {
                    "--tag-id" | "--id" => tag_id = Some(next_val(inline, &mut it)?),
                    "--from" => from_name = Some(next_val(inline, &mut it)?),
                    "--name" | "--to" => name = Some(next_val(inline, &mut it)?),
                    _ => {
                        return Err(CliError::new(
                            ErrorCode::InvalidMessage,
                            "Unknown option for tag rename",
                        ));
                    }
                }
            }
            let name = name.ok_or_else(|| {
                CliError::new(
                    ErrorCode::InvalidMessage,
                    "tag rename requires --name <NEW_NAME>",
                )
            })?;
            if tag_id.is_none() && from_name.is_none() {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "tag rename requires --tag-id <ID> or --from <OLD_NAME>",
                ));
            }
            Ok(TagAction::Rename {
                tag_id,
                from_name,
                name,
            })
        }
        "delete" => {
            let mut tag_id = None;
            let mut name = None;
            let mut it = rest.iter().peekable();
            while let Some(arg) = it.next() {
                let (flag, inline) = split_flag(arg);
                match flag {
                    "--tag-id" | "--id" => tag_id = Some(next_val(inline, &mut it)?),
                    "--name" | "--tag" => name = Some(next_val(inline, &mut it)?),
                    _ if !flag.starts_with('-') && name.is_none() && tag_id.is_none() => {
                        name = Some(arg.clone());
                    }
                    _ => {
                        return Err(CliError::new(
                            ErrorCode::InvalidMessage,
                            "Unknown option for tag delete",
                        ));
                    }
                }
            }
            if tag_id.is_none() && name.is_none() {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "tag delete requires --tag-id <ID> or --name <TAG>",
                ));
            }
            Ok(TagAction::Delete { tag_id, name })
        }
        _ => Err(CliError::new(
            ErrorCode::InvalidMessage,
            "Unsupported tag action; use list, add, remove, rename, or delete",
        )),
    }
}

fn parse_note(args: &[String]) -> Result<Command, CliError> {
    let mut id = None;
    let mut text = None;
    let mut clear = false;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--id" => id = Some(next_val(inline, &mut it)?),
            "--text" | "--note" => text = Some(next_val(inline, &mut it)?),
            "--clear" => clear = true,
            _ if !flag.starts_with('-') && id.is_none() => id = Some(arg.clone()),
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for note",
                ));
            }
        }
    }
    let id =
        id.ok_or_else(|| CliError::new(ErrorCode::InvalidMessage, "note requires --id <NODE_ID>"))?;
    let note = if clear {
        String::new()
    } else {
        text.ok_or_else(|| {
            CliError::new(
                ErrorCode::InvalidMessage,
                "note requires --text <NOTE> or --clear",
            )
        })?
    };
    Ok(Command::Note { id, note })
}

fn parse_summary(args: &[String]) -> Result<Command, CliError> {
    let mut id = None;
    let mut text = None;
    let mut clear = false;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--id" => id = Some(next_val(inline, &mut it)?),
            "--text" | "--summary" => text = Some(next_val(inline, &mut it)?),
            "--clear" => clear = true,
            _ if !flag.starts_with('-') && id.is_none() => id = Some(arg.clone()),
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for summary",
                ));
            }
        }
    }
    let id = id.ok_or_else(|| {
        CliError::new(ErrorCode::InvalidMessage, "summary requires --id <NODE_ID>")
    })?;
    let summary = if clear {
        None
    } else {
        Some(text.ok_or_else(|| {
            CliError::new(
                ErrorCode::InvalidMessage,
                "summary requires --text <SUMMARY> or --clear",
            )
        })?)
    };
    Ok(Command::Summary { id, summary })
}

fn parse_backup(args: &[String]) -> Result<Command, CliError> {
    let mut output = None;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--output" | "-o" => output = Some(next_val(inline, &mut it)?),
            _ if !flag.starts_with('-') && output.is_none() => output = Some(arg.clone()),
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for backup",
                ));
            }
        }
    }
    let raw = output.ok_or_else(|| {
        CliError::new(
            ErrorCode::InvalidMessage,
            "backup requires --output <ABS_SQLITE_FILE>",
        )
    })?;
    let output = require_absolute_path(&raw, "--output must be an absolute file path")?;
    Ok(Command::Backup { output })
}

fn parse_export(args: &[String]) -> Result<Command, CliError> {
    let mut format = EditDocumentKind::Html;
    let mut output = None;
    let mut overwrite = false;
    let mut it = args.iter().peekable();
    while let Some(arg) = it.next() {
        let (flag, inline) = split_flag(arg);
        match flag {
            "--format" => {
                let raw = next_val(inline, &mut it)?;
                format = match raw.as_str() {
                    "html" | "netscape_html" => EditDocumentKind::Html,
                    "json" | "sidecar" => EditDocumentKind::Sidecar,
                    _ => {
                        return Err(CliError::new(
                            ErrorCode::InvalidMessage,
                            "--format must be html or json",
                        ));
                    }
                };
            }
            "--output" | "-o" => output = Some(next_val(inline, &mut it)?),
            "--overwrite" => overwrite = true,
            _ => {
                return Err(CliError::new(
                    ErrorCode::InvalidMessage,
                    "Unknown option for export",
                ));
            }
        }
    }
    let raw = output.ok_or_else(|| {
        CliError::new(
            ErrorCode::InvalidMessage,
            "export requires --output <ABS_FILE_PATH>",
        )
    })?;
    let output = require_absolute_path(&raw, "--output must be an absolute file path")?;
    Ok(Command::Export {
        format,
        output,
        overwrite,
    })
}

fn resolve_tag_id_from_catalog(
    catalog: &TagCatalog,
    tag_id: Option<&str>,
    name: Option<&str>,
) -> Result<Id, CliError> {
    if let Some(raw_id) = tag_id {
        let id = Id::new(raw_id)?;
        if catalog.tags.iter().any(|item| item.tag_id == id) {
            return Ok(id);
        }
        return Err(CliError::from_code(ErrorCode::InvalidMessage));
    }
    let raw_name = name.ok_or_else(|| CliError::from_code(ErrorCode::InvalidMessage))?;
    let wanted = tag_rules::normalize_tag(raw_name)?;
    for item in &catalog.tags {
        if let Ok(item_norm) = tag_rules::normalize_tag(&item.name)
            && item_norm.key == wanted.key
        {
            return Ok(item.tag_id.clone());
        }
    }
    if let Ok(as_id) = Id::new(raw_name)
        && catalog.tags.iter().any(|item| item.tag_id == as_id)
    {
        return Ok(as_id);
    }
    Err(CliError::from_code(ErrorCode::InvalidMessage))
}

fn empty_uninitialized_status() -> LocalSkillsStatus {
    LocalSkillsStatus {
        schema_version: SCHEMA_VERSION,
        initialized: false,
        profile_id: LOCAL_SKILLS_PROFILE_ID.to_owned(),
        display_name: LOCAL_SKILLS_DISPLAY_NAME.to_owned(),
        root_id: LOCAL_SKILLS_ROOT_ID.to_owned(),
        source_epoch: None,
        revision: 0,
        folder_count: 0,
        bookmark_count: 0,
        last_synced_at: None,
    }
}

fn empty_page(offset: u64) -> Result<LibraryQueryPage, CliError> {
    Ok(LibraryQueryPage {
        items: Vec::new(),
        source_epoch: SourceEpoch::new(1)?,
        revision: Counter::new(0)?,
        total: Counter::new(0)?,
        offset: Counter::new(offset)?,
        next_offset: RequiredNullable(None),
    })
}

async fn execute(globals: GlobalOptions, command: Command) -> Result<Value, CliError> {
    if matches!(command, Command::Help) {
        return Ok(json!({
            "ok": true,
            "command": "help",
            "binary": "markbridge-skill",
            "profileId": LOCAL_SKILLS_PROFILE_ID,
            "rootId": LOCAL_SKILLS_ROOT_ID,
            "globalFlags": ["--app-data <ABS_DIR>", "--allow-daily-db", "--profile <ID>"],
            "subcommands": [
                "status", "init", "tree", "list", "search", "get",
                "mkdir", "add", "update", "move", "delete",
                "tag", "note", "summary", "backup", "export"
            ]
        }));
    }

    let profile_id = Id::new(&globals.profile_id)?;
    if profile_id.as_str() != LOCAL_SKILLS_PROFILE_ID {
        return Err(CliError::from_code(ErrorCode::WrongProfile));
    }

    let daily = is_daily_database_path(&globals.app_data);
    if command.is_write() && daily && !globals.allow_daily_db {
        return Err(CliError::new(
            ErrorCode::ReadOnly,
            "Daily database write requires --allow-daily-db",
        ));
    }

    let db_path = globals.app_data.join(DB_FILENAME);
    // Avoid creating daily directory/SQLite file on read-only probes if daily DB does not exist yet.
    if !command.is_write() && daily && !db_path.exists() {
        return match command {
            Command::Status => Ok(json!({
                "ok": true,
                "command": "status",
                "status": empty_uninitialized_status(),
            })),
            Command::Tree { .. } => Ok(json!({
                "ok": true,
                "command": "tree",
                "initialized": false,
                "profileId": LOCAL_SKILLS_PROFILE_ID,
                "items": [],
            })),
            Command::List {
                folder_id, offset, ..
            } => Ok(json!({
                "ok": true,
                "command": "list",
                "initialized": false,
                "profileId": LOCAL_SKILLS_PROFILE_ID,
                "folderId": folder_id,
                "page": empty_page(offset)?,
            })),
            Command::Search { offset, .. } => Ok(json!({
                "ok": true,
                "command": "search",
                "initialized": false,
                "profileId": LOCAL_SKILLS_PROFILE_ID,
                "page": empty_page(offset)?,
            })),
            _ => Err(CliError::from_code(ErrorCode::Unpaired)),
        };
    }

    std::fs::create_dir_all(&globals.app_data)
        .map_err(|_| CliError::from_code(ErrorCode::StorageError))?;
    let storage = Storage::open(&db_path).await?;
    let result = execute_with_storage(&storage, profile_id, command).await;
    let close_res = storage.close().await;
    let payload = result?;
    close_res?;
    Ok(payload)
}

async fn execute_with_storage(
    storage: &Storage,
    profile_id: Id,
    command: Command,
) -> Result<Value, CliError> {
    match command {
        Command::Help => unreachable!(),
        Command::Status => {
            let status = storage.local_skills_status().await?;
            Ok(json!({
                "ok": true,
                "command": "status",
                "status": status,
            }))
        }
        Command::Init => {
            let status = storage.ensure_local_skills_space().await?;
            Ok(json!({
                "ok": true,
                "command": "init",
                "status": status,
            }))
        }
        Command::Tree { folder_id, depth } => {
            let folder = folder_id.map(Id::new).transpose()?;
            let status = storage.local_skills_status().await?;
            let items = storage.local_tree(profile_id, folder, depth).await?;
            Ok(json!({
                "ok": true,
                "command": "tree",
                "initialized": status.initialized,
                "profileId": LOCAL_SKILLS_PROFILE_ID,
                "items": items,
            }))
        }
        Command::List {
            folder_id,
            scope,
            offset,
            limit,
        } => {
            let status = storage.local_skills_status().await?;
            if !status.initialized {
                if let Some(ref f_id) = folder_id
                    && f_id != LOCAL_SKILLS_ROOT_ID
                {
                    let _ = storage
                        .local_tree(profile_id, Some(Id::new(f_id)?), Some(1))
                        .await?;
                }
                return Ok(json!({
                    "ok": true,
                    "command": "list",
                    "initialized": false,
                    "profileId": LOCAL_SKILLS_PROFILE_ID,
                    "folderId": folder_id,
                    "page": empty_page(offset)?,
                }));
            }
            let query = LibraryQuery {
                folder_id: RequiredNullable(folder_id.as_deref().map(Id::new).transpose()?),
                folder_scope: scope,
                query: Title::new("")?,
                tag_ids: Vec::new(),
                include_summary: false,
                include_note: false,
                offset: Counter::new(offset)?,
                limit: Counter::new(limit)?,
                expected_revision: RequiredNullable(None),
                expected_source_epoch: RequiredNullable(None),
            };
            let page = storage.query_library(profile_id, query).await?;
            Ok(json!({
                "ok": true,
                "command": "list",
                "initialized": true,
                "profileId": LOCAL_SKILLS_PROFILE_ID,
                "folderId": folder_id,
                "page": page,
            }))
        }
        Command::Search {
            query,
            folder_id,
            scope,
            tags,
            include_summary,
            include_note,
            offset,
            limit,
        } => {
            let status = storage.local_skills_status().await?;
            if !status.initialized {
                return Ok(json!({
                    "ok": true,
                    "command": "search",
                    "initialized": false,
                    "profileId": LOCAL_SKILLS_PROFILE_ID,
                    "page": empty_page(offset)?,
                }));
            }
            let mut tag_ids = Vec::new();
            if !tags.is_empty() {
                let catalog = storage
                    .tag_catalog(profile_id.clone(), Vec::new(), None)
                    .await?;
                for raw in &tags {
                    match resolve_tag_id_from_catalog(&catalog, None, Some(raw)) {
                        Ok(id) => {
                            if !tag_ids.contains(&id) {
                                tag_ids.push(id);
                            }
                        }
                        Err(_) => {
                            // Non-existent tag filter yields an empty result set cleanly.
                            return Ok(json!({
                                "ok": true,
                                "command": "search",
                                "initialized": true,
                                "profileId": LOCAL_SKILLS_PROFILE_ID,
                                "page": empty_page(offset)?,
                            }));
                        }
                    }
                }
            }
            let lib_query = LibraryQuery {
                folder_id: RequiredNullable(folder_id.as_deref().map(Id::new).transpose()?),
                folder_scope: scope,
                query: Title::new(query)?,
                tag_ids,
                include_summary,
                include_note,
                offset: Counter::new(offset)?,
                limit: Counter::new(limit)?,
                expected_revision: RequiredNullable(None),
                expected_source_epoch: RequiredNullable(None),
            };
            let page = storage.query_library(profile_id, lib_query).await?;
            Ok(json!({
                "ok": true,
                "command": "search",
                "initialized": true,
                "profileId": LOCAL_SKILLS_PROFILE_ID,
                "page": page,
            }))
        }
        Command::Get { id } => {
            let detail = storage.local_node_detail(profile_id, Id::new(id)?).await?;
            Ok(json!({
                "ok": true,
                "command": "get",
                "detail": detail,
            }))
        }
        Command::Mkdir {
            parent_id,
            title,
            position,
        } => {
            let parent = parent_id.map(Id::new).transpose()?;
            let result = storage
                .local_mkdir(profile_id, parent, title, position)
                .await?;
            Ok(json!({
                "ok": true,
                "command": "mkdir",
                "result": result,
            }))
        }
        Command::Add {
            parent_id,
            title,
            url,
            position,
            tags,
            note,
            summary,
        } => {
            let parent = parent_id.map(Id::new).transpose()?;
            let result = storage
                .local_add_bookmark(
                    profile_id, parent, title, url, position, tags, note, summary,
                )
                .await?;
            Ok(json!({
                "ok": true,
                "command": "add",
                "result": result,
            }))
        }
        Command::Update { id, title, url } => {
            let result = storage
                .local_update_node(profile_id, Id::new(id)?, title, url)
                .await?;
            Ok(json!({
                "ok": true,
                "command": "update",
                "result": result,
            }))
        }
        Command::Move {
            id,
            parent_id,
            position,
        } => {
            let result = storage
                .local_move_node(profile_id, Id::new(id)?, Id::new(parent_id)?, position)
                .await?;
            Ok(json!({
                "ok": true,
                "command": "move",
                "result": result,
            }))
        }
        Command::Delete {
            id,
            recursive,
            backup,
        } => {
            let backup_outcome = match backup {
                Some(dest) => Some(storage.backup_database(dest).await?),
                None => None,
            };
            let result = storage
                .local_delete_node(profile_id, Id::new(id)?, recursive)
                .await?;
            Ok(json!({
                "ok": true,
                "command": "delete",
                "result": result,
                "backup": backup_outcome,
            }))
        }
        Command::Tag(action) => match action {
            TagAction::List { chrome_ids, filter } => {
                let status = storage.local_skills_status().await?;
                if !status.initialized {
                    return Ok(json!({
                        "ok": true,
                        "command": "tag",
                        "action": "list",
                        "initialized": false,
                        "tags": [],
                        "entries": [],
                        "matches": [],
                    }));
                }
                let ids: Vec<Id> = chrome_ids
                    .into_iter()
                    .map(Id::new)
                    .collect::<Result<_, _>>()?;
                let filter_id = if let Some(raw_filter) = filter {
                    let base = storage
                        .tag_catalog(profile_id.clone(), Vec::new(), None)
                        .await?;
                    Some(resolve_tag_id_from_catalog(&base, None, Some(&raw_filter))?)
                } else {
                    None
                };
                let catalog = storage.tag_catalog(profile_id, ids, filter_id).await?;
                Ok(json!({
                    "ok": true,
                    "command": "tag",
                    "action": "list",
                    "initialized": true,
                    "catalog": catalog,
                }))
            }
            TagAction::Add { chrome_ids, name } => {
                let ids: Vec<Id> = chrome_ids
                    .into_iter()
                    .map(Id::new)
                    .collect::<Result<_, _>>()?;
                let catalog = storage
                    .local_mutate_tags(
                        profile_id,
                        TagCommand::Add {
                            chrome_ids: ids,
                            name,
                        },
                    )
                    .await?;
                Ok(json!({
                    "ok": true,
                    "command": "tag",
                    "action": "add",
                    "catalog": catalog,
                }))
            }
            TagAction::Remove {
                chrome_ids,
                tag_id,
                name,
            } => {
                let ids: Vec<Id> = chrome_ids
                    .into_iter()
                    .map(Id::new)
                    .collect::<Result<_, _>>()?;
                let base = storage
                    .tag_catalog(profile_id.clone(), Vec::new(), None)
                    .await?;
                let resolved =
                    resolve_tag_id_from_catalog(&base, tag_id.as_deref(), name.as_deref())?;
                let catalog = storage
                    .local_mutate_tags(
                        profile_id,
                        TagCommand::Remove {
                            chrome_ids: ids,
                            tag_id: resolved,
                        },
                    )
                    .await?;
                Ok(json!({
                    "ok": true,
                    "command": "tag",
                    "action": "remove",
                    "catalog": catalog,
                }))
            }
            TagAction::Rename {
                tag_id,
                from_name,
                name,
            } => {
                let base = storage
                    .tag_catalog(profile_id.clone(), Vec::new(), None)
                    .await?;
                let resolved =
                    resolve_tag_id_from_catalog(&base, tag_id.as_deref(), from_name.as_deref())?;
                let catalog = storage
                    .local_mutate_tags(
                        profile_id,
                        TagCommand::Rename {
                            tag_id: resolved,
                            name,
                        },
                    )
                    .await?;
                Ok(json!({
                    "ok": true,
                    "command": "tag",
                    "action": "rename",
                    "catalog": catalog,
                }))
            }
            TagAction::Delete { tag_id, name } => {
                let base = storage
                    .tag_catalog(profile_id.clone(), Vec::new(), None)
                    .await?;
                let resolved =
                    resolve_tag_id_from_catalog(&base, tag_id.as_deref(), name.as_deref())?;
                let catalog = storage
                    .local_mutate_tags(profile_id, TagCommand::Delete { tag_id: resolved })
                    .await?;
                Ok(json!({
                    "ok": true,
                    "command": "tag",
                    "action": "delete",
                    "catalog": catalog,
                }))
            }
        },
        Command::Note { id, note } => {
            let node_id = Id::new(id)?;
            storage
                .local_mutate_tags(
                    profile_id.clone(),
                    TagCommand::SetNote {
                        chrome_ids: vec![node_id.clone()],
                        note,
                    },
                )
                .await?;
            let detail = storage.local_node_detail(profile_id, node_id).await?;
            Ok(json!({
                "ok": true,
                "command": "note",
                "detail": detail,
            }))
        }
        Command::Summary { id, summary } => {
            let detail = storage
                .local_set_summary(profile_id, Id::new(id)?, summary)
                .await?;
            Ok(json!({
                "ok": true,
                "command": "summary",
                "detail": detail,
            }))
        }
        Command::Backup { output } => {
            let backup = storage.backup_database(output).await?;
            Ok(json!({
                "ok": true,
                "command": "backup",
                "backup": backup,
            }))
        }
        Command::Export {
            format,
            output,
            overwrite,
        } => {
            let (metadata, body) = storage.local_export(profile_id, format).await?;
            if let Some(parent) = output.parent()
                && !parent.as_os_str().is_empty()
            {
                std::fs::create_dir_all(parent)
                    .map_err(|_| CliError::from_code(ErrorCode::StorageError))?;
            }
            let bytes = body.len() as u64;
            if overwrite {
                std::fs::write(&output, body.as_bytes())
                    .map_err(|_| CliError::from_code(ErrorCode::StorageError))?;
            } else {
                use std::io::Write;
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&output)
                    .map_err(|err| {
                        if err.kind() == std::io::ErrorKind::AlreadyExists {
                            CliError::from_code(ErrorCode::Conflict)
                        } else {
                            CliError::from_code(ErrorCode::StorageError)
                        }
                    })?;
                file.write_all(body.as_bytes())
                    .map_err(|_| CliError::from_code(ErrorCode::StorageError))?;
            }
            Ok(json!({
                "ok": true,
                "command": "export",
                "metadata": metadata,
                "bytes": bytes,
            }))
        }
    }
}

pub async fn run_from_slice(args: &[String], env_app_data: Option<String>) -> (u8, Value) {
    match parse_cli(args, env_app_data) {
        Ok((globals, cmd)) => match execute(globals, cmd).await {
            Ok(payload) => (0, payload),
            Err(err) => (
                err.exit_code(),
                serde_json::to_value(ErrorEnvelope {
                    ok: false,
                    error_code: err.code,
                    message: err.message,
                })
                .expect("error serializes"),
            ),
        },
        Err(err) => (
            err.exit_code(),
            serde_json::to_value(ErrorEnvelope {
                ok: false,
                error_code: err.code,
                message: err.message,
            })
            .expect("error serializes"),
        ),
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    let raw_args: Vec<String> = env::args().skip(1).collect();
    let env_app_data = env::var("MARKBRIDGE_APP_DATA").ok();
    let (code, payload) = run_from_slice(&raw_args, env_app_data).await;
    println!(
        "{}",
        serde_json::to_string(&payload).expect("response serializes")
    );
    ExitCode::from(code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use markbridge_core::storage::{PairedOrigin, Profile, ProfileOrigin};
    use markbridge_protocol::{BookmarkNode, DisplayName, NodeKind, Position, TreeSnapshot, Url};

    fn cli_args(dir: &Path, parts: &[&str]) -> Vec<String> {
        let mut out = vec!["--app-data".to_owned(), dir.to_str().unwrap().to_owned()];
        out.extend(parts.iter().map(|s| (*s).to_owned()));
        out
    }

    async fn run_ok(dir: &Path, parts: &[&str]) -> Value {
        let (code, body) = run_from_slice(&cli_args(dir, parts), None).await;
        assert_eq!(code, 0, "expected ok for {parts:?}, got {body}");
        assert_eq!(
            body["ok"], true,
            "expected ok=true for {parts:?}, got {body}"
        );
        body
    }

    async fn run_err(dir: &Path, parts: &[&str], expected_code: &str) -> Value {
        let (code, body) = run_from_slice(&cli_args(dir, parts), None).await;
        assert_ne!(code, 0, "expected failure for {parts:?}, got {body}");
        assert_eq!(body["ok"], false);
        assert_eq!(
            body["errorCode"], expected_code,
            "for {parts:?}, got {body}"
        );
        body
    }

    #[tokio::test]
    async fn full_lifecycle_crud_fts_trigram_and_export() {
        let tmp = tempfile::tempdir().unwrap();
        let app_data = tmp.path().join("isolated-mb-data");

        // Lazy status before init
        let st0 = run_ok(&app_data, &["status"]).await;
        assert_eq!(st0["status"]["initialized"], false);
        assert_eq!(st0["status"]["schemaVersion"], 8);

        // Init creates local-skills and skills-root idempotently
        let init1 = run_ok(&app_data, &["init"]).await;
        assert_eq!(init1["status"]["initialized"], true);
        assert_eq!(init1["status"]["schemaVersion"], 8);
        assert_eq!(init1["status"]["revision"], 1);
        assert_eq!(init1["status"]["folderCount"], 1);
        assert_eq!(init1["status"]["bookmarkCount"], 0);
        let init2 = run_ok(&app_data, &["init"]).await;
        assert_eq!(init2["status"]["revision"], 1);

        // Mkdir nested folders
        let f_ai = run_ok(&app_data, &["mkdir", "--title", "AI 研究"]).await;
        let ai_id = f_ai["result"]["node"]["chromeId"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(ai_id.starts_with("local-f:"));
        let f_rust = run_ok(&app_data, &["mkdir", "--title", "Rust 资料"]).await;
        let rust_id = f_rust["result"]["node"]["chromeId"]
            .as_str()
            .unwrap()
            .to_owned();

        // Add bookmarks with tags, note, summary
        let b1 = run_ok(
            &app_data,
            &[
                "add",
                "--parent",
                &ai_id,
                "--title",
                "OpenAI Spec",
                "--url",
                "https://platform.openai.com/docs",
                "--tags",
                "LLM,Agent",
                "--note",
                "短注",
                "--summary",
                "深入讲解多智能体协同与工具调用架构设计",
            ],
        )
        .await;
        let b1_id = b1["result"]["node"]["chromeId"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(b1_id.starts_with("local-b:"));

        let b2 = run_ok(
            &app_data,
            &[
                "add",
                "--parent",
                &ai_id,
                "--title",
                "SQLite WAL Internals",
                "--url",
                "https://www.sqlite.org/wal.html",
            ],
        )
        .await;
        let b2_id = b2["result"]["node"]["chromeId"]
            .as_str()
            .unwrap()
            .to_owned();

        // Search: 1-2 char short query & 3+ char FTS5 trigram query on summary/note + tag filter
        let hit_short = run_ok(&app_data, &["search", "--query", "短注"]).await;
        assert_eq!(hit_short["page"]["total"], 1);
        assert_eq!(hit_short["page"]["items"][0]["chromeId"], b1_id);

        let hit_trigram = run_ok(&app_data, &["search", "--query", "多智能体协同"]).await;
        assert_eq!(hit_trigram["page"]["total"], 1);
        assert_eq!(hit_trigram["page"]["items"][0]["chromeId"], b1_id);

        let hit_tag = run_ok(&app_data, &["search", "--tag", "llm"]).await;
        assert_eq!(hit_tag["page"]["total"], 1);

        // Update title & URL
        let upd = run_ok(
            &app_data,
            &[
                "update",
                "--id",
                &b2_id,
                "--title",
                "SQLite Write-Ahead Logging",
                "--url",
                "https://sqlite.org/wal.html",
            ],
        )
        .await;
        assert_eq!(upd["result"]["node"]["title"], "SQLite Write-Ahead Logging");

        // Tag, Note, Summary standalone commands
        run_ok(
            &app_data,
            &["tag", "add", "--id", &b2_id, "--name", "Database"],
        )
        .await;
        run_ok(
            &app_data,
            &["tag", "rename", "--from", "Database", "--name", "SQLite"],
        )
        .await;
        let tag_list = run_ok(&app_data, &["tag", "list"]).await;
        assert_eq!(tag_list["catalog"]["tags"].as_array().unwrap().len(), 3);
        run_ok(
            &app_data,
            &["note", "--id", &b2_id, "--text", "必读并发文档"],
        )
        .await;
        run_ok(
            &app_data,
            &[
                "summary",
                "--id",
                &b2_id,
                "--text",
                "SQLite WAL 读写并发机制说明",
            ],
        )
        .await;

        let detail = run_ok(&app_data, &["get", "--id", &b2_id]).await;
        assert_eq!(detail["detail"]["note"], "必读并发文档");
        assert_eq!(detail["detail"]["summary"], "SQLite WAL 读写并发机制说明");
        assert_eq!(
            detail["detail"]["ancestors"],
            json!(["Skills 书签", "AI 研究"])
        );

        // Move bookmark across folders & check contiguous sibling positions
        run_ok(
            &app_data,
            &[
                "move",
                "--id",
                &b2_id,
                "--parent",
                &rust_id,
                "--position",
                "0",
            ],
        )
        .await;
        let rust_list = run_ok(&app_data, &["list", "--folder", &rust_id]).await;
        assert_eq!(rust_list["page"]["total"], 1);
        assert_eq!(rust_list["page"]["items"][0]["position"], 0);

        let tree_out = run_ok(&app_data, &["tree"]).await;
        assert_eq!(
            tree_out["items"][0]["node"]["chromeId"],
            LOCAL_SKILLS_ROOT_ID
        );

        // Export HTML & JSON
        let html_path = tmp.path().join("export.html");
        let json_path = tmp.path().join("export.json");
        run_ok(
            &app_data,
            &[
                "export",
                "--format",
                "html",
                "--output",
                html_path.to_str().unwrap(),
            ],
        )
        .await;
        run_ok(
            &app_data,
            &[
                "export",
                "--format",
                "json",
                "--output",
                json_path.to_str().unwrap(),
            ],
        )
        .await;
        assert!(
            std::fs::read_to_string(&html_path)
                .unwrap()
                .contains("OpenAI Spec")
        );
        assert!(
            std::fs::read_to_string(&json_path)
                .unwrap()
                .contains("多智能体协同")
        );

        // Delete non-empty folder without --recursive -> CONFLICT, then with --recursive -> OK
        run_err(&app_data, &["delete", "--id", &ai_id], "CONFLICT").await;
        let backup_before_del = tmp.path().join("pre-delete.sqlite");
        let del = run_ok(
            &app_data,
            &[
                "delete",
                "--id",
                &ai_id,
                "--recursive",
                "--backup",
                backup_before_del.to_str().unwrap(),
            ],
        )
        .await;
        assert_eq!(del["result"]["deletedCount"], 2);
        assert!(backup_before_del.exists());
    }

    #[tokio::test]
    async fn enforces_safety_gates_root_protection_url_rules_and_chrome_isolation() {
        let tmp = tempfile::tempdir().unwrap();

        // 1. Daily DB gate rejects writes without --allow-daily-db and does NOT create DB file
        let fake_daily = tmp.path().join("com.markbridge.desktop");
        let (code, err) = run_from_slice(
            &[
                "--app-data".into(),
                fake_daily.to_str().unwrap().into(),
                "init".into(),
            ],
            None,
        )
        .await;
        assert_eq!(code, 2);
        assert_eq!(err["errorCode"], "READ_ONLY");
        assert!(!fake_daily.join(DB_FILENAME).exists());

        // With --allow-daily-db on isolated fake path, init succeeds
        let (code_ok, ok_body) = run_from_slice(
            &[
                "--app-data".into(),
                fake_daily.to_str().unwrap().into(),
                "--allow-daily-db".into(),
                "init".into(),
            ],
            None,
        )
        .await;
        assert_eq!(code_ok, 0, "{ok_body}");

        // 2. Protected root, cycles, bookmark-as-parent, URL rules, and Chrome profile isolation
        let app_data = tmp.path().join("sandbox");
        run_ok(&app_data, &["init"]).await;
        let f_parent = run_ok(&app_data, &["mkdir", "--title", "Parent"]).await;
        let p_id = f_parent["result"]["node"]["chromeId"]
            .as_str()
            .unwrap()
            .to_owned();
        let f_child = run_ok(&app_data, &["mkdir", "--parent", &p_id, "--title", "Child"]).await;
        let c_id = f_child["result"]["node"]["chromeId"]
            .as_str()
            .unwrap()
            .to_owned();
        let bm = run_ok(
            &app_data,
            &[
                "add",
                "--parent",
                &p_id,
                "--title",
                "Doc",
                "--url",
                "https://example.com/doc",
            ],
        )
        .await;
        let bm_id = bm["result"]["node"]["chromeId"]
            .as_str()
            .unwrap()
            .to_owned();

        // Protect skills-root
        run_err(
            &app_data,
            &["delete", "--id", "skills-root", "--recursive"],
            "PROTECTED_NODE",
        )
        .await;
        run_err(
            &app_data,
            &["move", "--id", "skills-root", "--parent", &p_id],
            "PROTECTED_NODE",
        )
        .await;
        run_err(
            &app_data,
            &[
                "update",
                "--id",
                "skills-root",
                "--url",
                "https://example.com",
            ],
            "PROTECTED_NODE",
        )
        .await;

        // Reject cycles & bookmark-as-parent
        run_err(
            &app_data,
            &["move", "--id", &p_id, "--parent", &c_id],
            "INVALID_TREE",
        )
        .await;
        run_err(
            &app_data,
            &["move", "--id", &p_id, "--parent", &p_id],
            "INVALID_TREE",
        )
        .await;
        run_err(
            &app_data,
            &["mkdir", "--parent", &bm_id, "--title", "Bad"],
            "INVALID_TREE",
        )
        .await;

        // Reject dangerous / malformed URLs without leaving partial data or leaking secrets
        for bad_url in [
            "javascript:alert(1)",
            "file:///C:/Windows/System32/drivers/etc/hosts",
            "https://admin:supersecret@example.com/private",
            "https://example.com/space in url",
        ] {
            let err_out = run_err(
                &app_data,
                &["add", "--title", "Bad", "--url", bad_url],
                "INVALID_MESSAGE",
            )
            .await;
            assert!(!err_out.to_string().contains("supersecret"));
        }

        // Seed a real Chrome profile into the same SQLite DB and verify CLI refuses to touch it
        {
            let storage = Storage::open(app_data.join(DB_FILENAME)).await.unwrap();
            let chrome_pid = Id::new("chrome-p1").unwrap();
            let epoch = SourceEpoch::new(1).unwrap();
            storage
                .create_profile(Profile {
                    id: chrome_pid.clone(),
                    instance_id: Id::new("inst-1").unwrap(),
                    source_epoch: epoch,
                    display_name: DisplayName::new("Work Chrome").unwrap(),
                    paired_origin: PairedOrigin::new(
                        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    )
                    .unwrap(),
                    credential_reference: None,
                })
                .await
                .unwrap();
            storage
                .replace_tree(
                    chrome_pid,
                    Id::new("sess-1").unwrap(),
                    TreeSnapshot {
                        source_epoch: epoch,
                        revision: Counter::new(1).unwrap(),
                        barrier_seq: Counter::new(1).unwrap(),
                        nodes: vec![
                            BookmarkNode {
                                chrome_id: Id::new("0").unwrap(),
                                parent_id: None,
                                position: Position::new(0).unwrap(),
                                kind: NodeKind::Folder,
                                title: Title::new("").unwrap(),
                                url: None,
                                folder_type: None,
                                unmodifiable: None,
                                date_added: None,
                                date_last_used: None,
                            },
                            BookmarkNode {
                                chrome_id: Id::new("chrome-bm-99").unwrap(),
                                parent_id: Some(Id::new("0").unwrap()),
                                position: Position::new(0).unwrap(),
                                kind: NodeKind::Bookmark,
                                title: Title::new("Chrome Only").unwrap(),
                                url: Some(Url::new("https://chrome.example/item").unwrap()),
                                folder_type: None,
                                unmodifiable: None,
                                date_added: None,
                                date_last_used: None,
                            },
                        ],
                    },
                )
                .await
                .unwrap();
            let profiles = storage.profiles().await.unwrap();
            assert_eq!(profiles.len(), 2);
            assert!(
                profiles
                    .iter()
                    .any(|p| p.profile.origin == ProfileOrigin::LocalSkills)
            );
            storage.close().await.unwrap();
        }

        // Passing --profile chrome-p1 OR targeting chrome-bm-99 via default profile -> WRONG_PROFILE
        let (p_code, p_err) = run_from_slice(
            &[
                "--app-data".into(),
                app_data.to_str().unwrap().into(),
                "--profile".into(),
                "chrome-p1".into(),
                "mkdir".into(),
                "--title".into(),
                "Nope".into(),
            ],
            None,
        )
        .await;
        assert_eq!(p_code, 2);
        assert_eq!(p_err["errorCode"], "WRONG_PROFILE");

        run_err(
            &app_data,
            &["update", "--id", "chrome-bm-99", "--title", "Hijack"],
            "WRONG_PROFILE",
        )
        .await;
        run_err(
            &app_data,
            &["delete", "--id", "chrome-bm-99"],
            "WRONG_PROFILE",
        )
        .await;
    }

    #[tokio::test]
    async fn backup_preserves_uncheckpointed_wal_and_semantic_triggers_fire() {
        let tmp = tempfile::tempdir().unwrap();
        let app_data = tmp.path().join("wal-test");
        let backup_file = tmp.path().join("backups").join("snapshot.sqlite");

        run_ok(&app_data, &["init"]).await;
        let added = run_ok(
            &app_data,
            &[
                "add",
                "--title",
                "Vector Item",
                "--url",
                "https://example.com/vec",
                "--summary",
                "Initial vector summary",
            ],
        )
        .await;
        let bm_chrome_id = added["result"]["node"]["chromeId"]
            .as_str()
            .unwrap()
            .to_owned();
        let bm_id = added["result"]["bookmarkId"].as_str().unwrap().to_owned();

        // Keep an active Storage handle open with uncommitted checkpoint (live WAL) while backing up,
        // and verify 008_semantic triggers transition ready -> paused/pending on summary/title change!
        let live = Storage::open(app_data.join(DB_FILENAME)).await.unwrap();
        live.local_add_bookmark(
            Id::new(LOCAL_SKILLS_PROFILE_ID).unwrap(),
            None,
            "Live WAL Bookmark".into(),
            "https://example.com/live-wal".into(),
            None,
            vec!["wal-tag".into()],
            Some("written into WAL before checkpoint".into()),
            None,
        )
        .await
        .unwrap();

        let backup_res = live.backup_database(backup_file.clone()).await.unwrap();
        assert_eq!(backup_res.schema_version, 8);
        assert!(backup_res.bytes > 0);
        // Second backup to same path must fail with CONFLICT (never overwrite)
        assert_eq!(
            live.backup_database(backup_file.clone()).await.unwrap_err(),
            ErrorCode::Conflict
        );

        // Open the backup file independently while `live` is still open!
        let restored = Storage::open(&backup_file).await.unwrap();
        let status = restored.local_skills_status().await.unwrap();
        assert_eq!(status.bookmark_count, 2);
        restored.close().await.unwrap();
        live.close().await.unwrap();

        // Verify 008_semantic triggers on title update and summary update using rusqlite on the DB
        {
            let conn = rusqlite::Connection::open(app_data.join(DB_FILENAME)).unwrap();
            conn.execute(
                "INSERT INTO semantic_indexes(index_id,profile_id,source_epoch,generation,phase,model,endpoint,recipe) VALUES('idx-local','local-skills',1,1,'ready','bge-m3','http://127.0.0.1:11434',1)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO semantic_members(index_id,bookmark_id,state,fingerprint,vector) VALUES('idx-local',?1,'ready','fp-1',X'0000803F')",
                [&bm_id],
            )
            .unwrap();
        }
        run_ok(
            &app_data,
            &[
                "summary",
                "--id",
                &bm_chrome_id,
                "--text",
                "Updated summary text",
            ],
        )
        .await;
        {
            let conn = rusqlite::Connection::open(app_data.join(DB_FILENAME)).unwrap();
            let phase: String = conn
                .query_row(
                    "SELECT phase FROM semantic_indexes WHERE index_id='idx-local'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            let state: String = conn
                .query_row(
                    "SELECT state FROM semantic_members WHERE index_id='idx-local' AND bookmark_id=?1",
                    [&bm_id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(phase, "paused");
            assert_eq!(state, "pending");

            // Reset to ready and verify title update trigger also fires
            conn.execute(
                "UPDATE semantic_indexes SET phase='ready' WHERE index_id='idx-local'",
                [],
            )
            .unwrap();
            conn.execute(
                "UPDATE semantic_members SET state='ready',fingerprint='fp-2' WHERE index_id='idx-local'",
                [],
            )
            .unwrap();
        }
        run_ok(
            &app_data,
            &[
                "update",
                "--id",
                &bm_chrome_id,
                "--title",
                "Renamed Vector Item",
            ],
        )
        .await;
        {
            let conn = rusqlite::Connection::open(app_data.join(DB_FILENAME)).unwrap();
            let (phase, state): (String, String) = conn
                .query_row(
                    "SELECT i.phase, m.state FROM semantic_indexes i JOIN semantic_members m ON m.index_id=i.index_id WHERE i.index_id='idx-local' AND m.bookmark_id=?1",
                    [&bm_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(phase, "paused");
            assert_eq!(state, "pending");
        }
    }
}
