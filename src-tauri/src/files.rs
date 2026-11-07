//! 録画フォルダの一覧と、動画サーバーへの配信許可。

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use tauri::State;

use crate::media::MediaServer;

/// 一覧に出す拡張子。WebView で再生できないものもあるが（mkv など）、見つけられるように出しておく。
const VIDEO_EXTS: &[&str] = &["mp4", "m4v", "mov", "mkv", "webm"];

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VideoFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// 最終更新時刻（UNIX エポックからのミリ秒）
    pub modified: f64,
}

pub fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| VIDEO_EXTS.iter().any(|x| x.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

fn file_info(path: &Path) -> Option<VideoFile> {
    // DirEntry::metadata() は Windows だとディレクトリエントリのキャッシュを返し、
    // OBS が書き込み中のファイルのサイズが古いままになる。必ずファイル本体に問い合わせる。
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    Some(VideoFile {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name()?.to_string_lossy().into_owned(),
        size: meta.len(),
        modified,
    })
}

/// フォルダ直下の動画を新しい順に返す（サブフォルダは見ない）。
pub fn scan_dir(dir: &Path) -> Result<Vec<VideoFile>, String> {
    let entries =
        fs::read_dir(dir).map_err(|e| format!("フォルダを開けません: {} ({e})", dir.display()))?;
    let mut files: Vec<VideoFile> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| is_video(p))
        .filter_map(|p| file_info(&p))
        .collect();
    files.sort_by(|a, b| {
        b.modified
            .total_cmp(&a.modified)
            .then_with(|| b.name.cmp(&a.name))
    });
    Ok(files)
}

/// 録画フォルダ（またはクリップフォルダ）の一覧。
/// 一覧に出たファイルはそのまま再生できるよう、動画サーバーにフォルダを許可する。
/// フォルダがまだ無い場合（クリップをまだ作っていない等）は空で返す。
#[tauri::command]
pub fn list_videos(media: State<Arc<MediaServer>>, dir: String) -> Result<Vec<VideoFile>, String> {
    let path = PathBuf::from(&dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    if !path.is_dir() {
        return Err(format!("フォルダではありません: {dir}"));
    }
    media.allow_dir(&path);
    scan_dir(&path)
}

/// ドラッグ&ドロップなど、一覧の外から開くファイルを再生できるようにする。
#[tauri::command]
pub fn open_external_file(
    media: State<Arc<MediaServer>>,
    path: String,
) -> Result<VideoFile, String> {
    let p = PathBuf::from(&path);
    if !is_video(&p) {
        return Err(format!("動画ファイルではありません: {path}"));
    }
    let info = file_info(&p).ok_or_else(|| format!("ファイルが見つかりません: {path}"))?;
    media.allow_file(&p);
    Ok(info)
}

/// エクスプローラーからクリップを Ctrl+V で Discord などに貼れるよう、ファイルとしてクリップボードに載せる。
#[tauri::command]
pub async fn copy_file_to_clipboard(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || copy_file_to_clipboard_impl(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn copy_file_to_clipboard_impl(path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    if !Path::new(path).is_file() {
        return Err(format!("ファイルが見つかりません: {path}"));
    }
    // パスは環境変数で渡す（引用符のエスケープ事故を避けるため）。
    // Set-Clipboard -LiteralPath は Windows PowerShell 5.1 にある。
    let out = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Set-Clipboard -LiteralPath $env:REPLAY_PLAYER_CLIP",
        ])
        .env("REPLAY_PLAYER_CLIP", path)
        .creation_flags(crate::ffmpeg::CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("PowerShell を起動できません: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(not(windows))]
fn copy_file_to_clipboard_impl(_path: &str) -> Result<(), String> {
    Err("ファイルのクリップボードコピーは Windows のみ対応です".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_only_videos_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("old.mp4");
        let new = dir.path().join("new.MKV");
        fs::write(&old, b"a").unwrap();
        fs::write(dir.path().join("note.txt"), b"x").unwrap();
        fs::create_dir(dir.path().join("clips")).unwrap();
        // 更新時刻に差をつける
        let t = std::time::SystemTime::now() - std::time::Duration::from_secs(60);
        fs::File::options()
            .write(true)
            .open(&old)
            .unwrap()
            .set_modified(t)
            .unwrap();
        fs::write(&new, b"bb").unwrap();

        let files = scan_dir(dir.path()).unwrap();
        let names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["new.MKV", "old.mp4"]);
        assert_eq!(files[0].size, 2);
    }
}
