//! Native-selected export destinations stay in Rust. No frontend filesystem scope.
use markbridge_core::bridge::ExportSnapshot;
use markbridge_protocol::{
    EditDocumentKind, ErrorCode, ExportSaveResult, ExportSaveStatus, RequiredNullable,
};
use std::{
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, AtomicU64, Ordering},
};

static SAVING: AtomicBool = AtomicBool::new(false);
static TEMP_ID: AtomicU64 = AtomicU64::new(0);
pub struct SaveGuard;
impl SaveGuard {
    pub fn acquire() -> Result<Self, ErrorCode> {
        SAVING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| ErrorCode::Conflict)?;
        Ok(Self)
    }
}
impl Drop for SaveGuard {
    fn drop(&mut self) {
        SAVING.store(false, Ordering::Release);
    }
}

pub async fn save(window: &tauri::WebviewWindow, snapshot: ExportSnapshot) -> ExportSaveResult {
    let selected = destination(window, snapshot.metadata.format).await;
    let (status, error) = match selected {
        Ok(Some(path)) => match tauri::async_runtime::spawn_blocking(move || {
            write_atomic(&path, snapshot.body.as_bytes())
        })
        .await
        {
            Ok(Ok(())) => (ExportSaveStatus::Saved, None),
            _ => (ExportSaveStatus::Failed, Some(ErrorCode::StorageError)),
        },
        Ok(None) => (ExportSaveStatus::Cancelled, None),
        Err(error) => (ExportSaveStatus::Failed, Some(error)),
    };
    ExportSaveResult {
        status,
        metadata: RequiredNullable(Some(snapshot.metadata)),
        error_code: RequiredNullable(error),
    }
}

struct Temporary(PathBuf);
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn write_atomic(path: &Path, body: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
    let (temporary, mut file) = loop {
        let temporary = parent.join(format!(
            ".markbridge-export-{}-{}.tmp",
            std::process::id(),
            TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => break (Temporary(temporary), file),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    };
    file.write_all(body)?;
    file.sync_all()?;
    drop(file);
    replace(&temporary.0, path)
}

#[cfg(windows)]
fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.encode_wide().chain(Some(0)).collect()
}

#[cfg(windows)]
fn replace(from: &Path, to: &Path) -> std::io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let (from, to) = (wide(from.as_os_str()), wide(to.as_os_str()));
    // Buffers are nul-terminated and remain alive for the synchronous system call.
    if unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}
#[cfg(not(windows))]
fn replace(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::rename(from, to)
}

#[cfg(windows)]
async fn destination(
    window: &tauri::WebviewWindow,
    kind: EditDocumentKind,
) -> Result<Option<PathBuf>, ErrorCode> {
    let owner = window.hwnd().map_err(|_| ErrorCode::StorageError)?.0 as usize;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let _ = sender.send(dialog(owner, kind));
        })
        .map_err(|_| ErrorCode::StorageError)?;
    receiver.await.map_err(|_| ErrorCode::StorageError)?
}
#[cfg(not(windows))]
async fn destination(
    _: &tauri::WebviewWindow,
    _: EditDocumentKind,
) -> Result<Option<PathBuf>, ErrorCode> {
    Err(ErrorCode::ReadOnly)
}

#[cfg(windows)]
fn dialog(owner: usize, kind: EditDocumentKind) -> Result<Option<PathBuf>, ErrorCode> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::UI::Controls::Dialogs::*;
    let (title, name, filter, extension) = match kind {
        EditDocumentKind::Html => (
            "保存书签 HTML",
            "bookmarks.html",
            "书签 HTML\0*.html\0\0",
            "html",
        ),
        EditDocumentKind::Sidecar => (
            "保存侧车 JSON",
            "bookmarks-sidecar.json",
            "侧车 JSON\0*.json\0\0",
            "json",
        ),
    };
    let mut filename = vec![0u16; 32768];
    let name = wide(name.as_ref());
    filename[..name.len()].copy_from_slice(&name);
    let title = wide(title.as_ref());
    let filter: Vec<u16> = filter.encode_utf16().collect();
    let extension = wide(extension.as_ref());
    let initial = std::env::var_os("MARKBRIDGE_APP_DATA")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_dir())
        .map(|path| wide(path.as_os_str()));
    let mut options = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        hwndOwner: owner as _,
        lpstrFilter: filter.as_ptr(),
        nFilterIndex: 1,
        lpstrFile: filename.as_mut_ptr(),
        nMaxFile: filename.len() as u32,
        lpstrTitle: title.as_ptr(),
        lpstrDefExt: extension.as_ptr(),
        lpstrInitialDir: initial
            .as_ref()
            .map_or(std::ptr::null(), |value| value.as_ptr()),
        Flags: OFN_EXPLORER
            | OFN_OVERWRITEPROMPT
            | OFN_PATHMUSTEXIST
            | OFN_NOCHANGEDIR
            | OFN_DONTADDTORECENT,
        ..Default::default()
    };
    // Owner is the trusted main window; all pointed-to UTF-16 buffers live through the dialog.
    if unsafe { GetSaveFileNameW(&mut options) } == 0 {
        return if unsafe { CommDlgExtendedError() } == 0 {
            Ok(None)
        } else {
            Err(ErrorCode::StorageError)
        };
    }
    let end = filename
        .iter()
        .position(|unit| *unit == 0)
        .ok_or(ErrorCode::StorageError)?;
    Ok(Some(PathBuf::from(std::ffi::OsString::from_wide(
        &filename[..end],
    ))))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_file_is_complete_and_failed_replace_preserves_destination_and_removes_temp() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("书签.html");
        write_atomic(&path, b"<!DOCTYPE NETSCAPE-Bookmark-file-1>\n").unwrap();
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"<!DOCTYPE NETSCAPE-Bookmark-file-1>\n"
        );
        let directory = root.path().join("existing");
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join("sentinel"), b"preserved").unwrap();
        assert!(write_atomic(&directory, b"wrong").is_err());
        assert_eq!(
            std::fs::read(directory.join("sentinel")).unwrap(),
            b"preserved"
        );
        assert!(std::fs::read_dir(root.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));
        write_atomic(&path, b"retry").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"retry");
    }
    #[cfg(windows)]
    #[test]
    fn locked_existing_file_is_unchanged_and_can_be_retried() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("locked.json");
        std::fs::write(&path, b"sentinel").unwrap();
        let held = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(write_atomic(&path, b"replacement").is_err());
        drop(held);
        assert_eq!(std::fs::read(&path).unwrap(), b"sentinel");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
        write_atomic(&path, b"replacement").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"replacement");
    }
}
