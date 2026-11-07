//! ffmpeg を呼んでクリップを書き出す。

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Windows で ffmpeg を起動したときに黒いコンソールが出ないようにするフラグ。
#[cfg_attr(not(windows), allow(dead_code))]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ClipMode {
    /// 再エンコードなし。一瞬で終わるが、開始位置が直前のキーフレームまで前にずれる。
    Fast,
    /// H.264 で再エンコード。フレーム単位で正確。
    Quality,
    /// 指定サイズ（既定 10MB）に収まるようビットレートと解像度を落とす。
    Discord,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipRequest {
    pub job_id: u32,
    pub input: String,
    pub start: f64,
    pub end: f64,
    pub mode: ClipMode,
    pub output_dir: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub ffmpeg_path: Option<String>,
    #[serde(default)]
    pub target_mb: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipResult {
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClipProgress {
    job_id: u32,
    ratio: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegInfo {
    pub path: String,
    pub version: String,
}

/// 実行中の書き出しジョブ（キャンセル用）。
#[derive(Default)]
pub struct Jobs {
    children: Mutex<HashMap<u32, Child>>,
    cancelled: Mutex<HashSet<u32>>,
}

fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

const FFMPEG_EXE: &str = if cfg!(windows) {
    "ffmpeg.exe"
} else {
    "ffmpeg"
};

/// ffmpeg の場所を決める。
/// 設定で指定があればそれだけを使う。なければアプリと同じフォルダ → よくあるインストール先 → PATH の順。
pub fn find_ffmpeg(custom: Option<&str>) -> Result<PathBuf, String> {
    if let Some(c) = custom.map(str::trim).filter(|c| !c.is_empty()) {
        let p = PathBuf::from(c);
        return if p.is_file() {
            Ok(p)
        } else {
            Err(format!("設定された ffmpeg が見つかりません: {c}"))
        };
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(Path::to_path_buf))
    {
        candidates.push(dir.join(FFMPEG_EXE));
    }
    #[cfg(windows)]
    {
        // winget はインストール直後だと PATH が反映されていないことがあるので直接見に行く
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join(r"Microsoft\WinGet\Links\ffmpeg.exe"));
        }
        if let Some(home) = std::env::var_os("USERPROFILE") {
            candidates.push(PathBuf::from(home).join(r"scoop\shims\ffmpeg.exe"));
        }
        candidates.push(PathBuf::from(r"C:\ProgramData\chocolatey\bin\ffmpeg.exe"));
        candidates.push(PathBuf::from(r"C:\ffmpeg\bin\ffmpeg.exe"));
    }
    if let Some(found) = candidates.into_iter().find(|p| p.is_file()) {
        return Ok(found);
    }
    // PATH から探す（見つからなければ起動時にエラーになる）
    Ok(PathBuf::from(FFMPEG_EXE))
}

#[tauri::command]
pub async fn check_ffmpeg(custom_path: Option<String>) -> Result<FfmpegInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = find_ffmpeg(custom_path.as_deref())?;
        let out = command(&path)
            .arg("-version")
            .stdin(Stdio::null())
            .output()
            .map_err(|_| "ffmpeg が見つかりません".to_string())?;
        if !out.status.success() {
            return Err("ffmpeg を実行できませんでした".into());
        }
        let version = String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()
            .unwrap_or("")
            .to_string();
        Ok(FfmpegInfo {
            path: path.to_string_lossy().into_owned(),
            version,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// 「1分23秒」→ "01m23s"、1時間以上なら "1h02m03s"。ファイル名用。
pub fn fmt_ts(secs: f64) -> String {
    let total = secs.max(0.0).floor() as u64;
    let (h, m, s) = (total / 3600, (total / 60) % 60, total % 60);
    if h > 0 {
        format!("{h}h{m:02}m{s:02}s")
    } else {
        format!("{m:02}m{s:02}s")
    }
}

/// Windows でファイル名に使えない文字を除く。
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']);
    trimmed.chars().take(120).collect()
}

/// 同名ファイルがあれば " (2)" などを付けて重ならない出力先を返す。
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}).{ext}")))
        .find(|p| !p.exists())
        .expect("unbounded iterator")
}

/// Discord モード用のビットレート計算。戻り値は (映像 kbps, 音声 kbps, 縦解像度の上限, fps の上限)。
pub fn discord_params(duration: f64, target_mb: f64) -> (u32, u32, u32, Option<u32>) {
    let duration = duration.max(0.5);
    // 1MB = 1000*1000 バイトで計算し、コンテナのオーバーヘッドと ABR のぶれを見て 1 割の余裕を取る
    let total_kbps = target_mb * 8000.0 / duration * 0.9;
    let audio_kbps: u32 = if total_kbps > 1200.0 {
        128
    } else if total_kbps > 500.0 {
        96
    } else {
        64
    };
    let video_kbps = (total_kbps - audio_kbps as f64).max(150.0) as u32;
    let (height, fps) = if video_kbps >= 4000 {
        (1080, None)
    } else if video_kbps >= 2000 {
        (720, None)
    } else if video_kbps >= 1000 {
        (720, Some(30))
    } else {
        (480, Some(30))
    };
    (video_kbps, audio_kbps, height, fps)
}

/// ffmpeg に渡す引数を組み立てる（出力パスを含む）。
pub fn build_args(
    mode: ClipMode,
    input: &str,
    start: f64,
    duration: f64,
    output: &str,
    target_mb: f64,
) -> Vec<String> {
    let mut a: Vec<String> = [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-nostats",
        "-progress",
        "pipe:1",
        "-n",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let mut push = |items: &[&str]| a.extend(items.iter().map(|s| s.to_string()));

    let ss = format!("{start:.3}");
    let t = format!("{duration:.3}");
    push(&["-ss", &ss, "-i", input, "-t", &t, "-map", "0:v:0"]);

    match mode {
        ClipMode::Fast => {
            push(&[
                "-map",
                "0:a?",
                "-c",
                "copy",
                "-avoid_negative_ts",
                "make_zero",
            ]);
        }
        ClipMode::Quality => {
            push(&[
                "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt",
                "yuv420p", "-c:a", "aac", "-b:a", "192k",
            ]);
        }
        ClipMode::Discord => {
            let (v, au, h, fps) = discord_params(duration, target_mb);
            let mut vf = format!("scale=-2:'min({h},ih)'");
            if let Some(f) = fps {
                vf.push_str(&format!(",fps='min({f},source_fps)'"));
            }
            let (bv, maxrate, bufsize, ba) = (
                format!("{v}k"),
                format!("{}k", v * 3 / 2),
                format!("{}k", v * 2),
                format!("{au}k"),
            );
            // Discord などで再生されるのは基本 1 本目の音声だけなので、音声は 1 本に絞ってサイズを節約
            push(&[
                "-map", "0:a:0?", "-vf", &vf, "-c:v", "libx264", "-preset", "veryfast", "-b:v",
                &bv, "-maxrate", &maxrate, "-bufsize", &bufsize, "-pix_fmt", "yuv420p", "-c:a",
                "aac", "-b:a", &ba, "-ac", "2",
            ]);
        }
    }
    push(&["-movflags", "+faststart", output]);
    a
}

#[tauri::command]
pub async fn export_clip(app: AppHandle, req: ClipRequest) -> Result<ClipResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_export(&app, req))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_clip(app: AppHandle, job_id: u32) {
    let jobs = app.state::<Jobs>();
    jobs.cancelled.lock().unwrap().insert(job_id);
    let mut children = jobs.children.lock().unwrap();
    if let Some(child) = children.get_mut(&job_id) {
        let _ = child.kill();
    }
}

fn run_export(app: &AppHandle, req: ClipRequest) -> Result<ClipResult, String> {
    let duration = req.end - req.start;
    if !(req.start >= 0.0 && duration >= 0.1) {
        return Err("クリップの範囲が正しくありません（IN と OUT を確認してください）".into());
    }
    let input = PathBuf::from(&req.input);
    if !input.is_file() {
        return Err(format!("元の動画が見つかりません: {}", req.input));
    }
    let ffmpeg = find_ffmpeg(req.ffmpeg_path.as_deref())?;

    let out_dir = PathBuf::from(&req.output_dir);
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("保存先フォルダを作れません: {} ({e})", out_dir.display()))?;

    let stem = match req
        .name
        .as_deref()
        .map(sanitize_file_name)
        .filter(|s| !s.is_empty())
    {
        Some(name) => name,
        None => {
            let src = input
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            format!("{src}_{}-{}", fmt_ts(req.start), fmt_ts(req.end))
        }
    };
    let output = unique_path(&out_dir, &stem, "mp4");
    let output_str = output.to_string_lossy().into_owned();

    let args = build_args(
        req.mode,
        &req.input,
        req.start,
        duration,
        &output_str,
        req.target_mb.unwrap_or(10.0),
    );

    let jobs = app.state::<Jobs>();
    let mut child = command(&ffmpeg)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "ffmpeg が見つかりません。設定画面で場所を指定するか、インストールしてください。"
                    .to_string()
            } else {
                format!("ffmpeg を起動できません: {e}")
            }
        })?;
    let stdout = child.stdout.take().expect("piped");
    let mut stderr = child.stderr.take().expect("piped");
    jobs.children.lock().unwrap().insert(req.job_id, child);

    // stderr は詰まらないよう別スレッドで読み切る
    let stderr_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    let job_id = req.job_id;
    let mut last_emit = -1.0_f64;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if let Some(us) = line
            .strip_prefix("out_time_us=")
            .and_then(|v| v.trim().parse::<f64>().ok())
        {
            let ratio = (us / 1_000_000.0 / duration).clamp(0.0, 1.0);
            if ratio - last_emit >= 0.01 {
                last_emit = ratio;
                let _ = app.emit("clip-progress", ClipProgress { job_id, ratio });
            }
        }
    }

    let child = jobs.children.lock().unwrap().remove(&job_id);
    let status = child.map(|mut c| c.wait());
    let stderr_text = stderr_reader.join().unwrap_or_default();
    let cancelled = jobs.cancelled.lock().unwrap().remove(&job_id);

    let ok = matches!(status, Some(Ok(s)) if s.success());
    if cancelled || !ok {
        let _ = std::fs::remove_file(&output);
        if cancelled {
            return Err("キャンセルしました".into());
        }
        let tail: Vec<&str> = stderr_text.lines().rev().take(6).collect();
        let detail = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
        return Err(if detail.is_empty() {
            "ffmpeg がエラーで終了しました".into()
        } else {
            format!("ffmpeg がエラーで終了しました:\n{detail}")
        });
    }

    let size = std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0);
    let _ = app.emit("clip-progress", ClipProgress { job_id, ratio: 1.0 });
    Ok(ClipResult {
        path: output_str,
        size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_timestamps_for_file_names() {
        assert_eq!(fmt_ts(0.0), "00m00s");
        assert_eq!(fmt_ts(83.9), "01m23s");
        assert_eq!(fmt_ts(3723.0), "1h02m03s");
        assert_eq!(fmt_ts(-3.0), "00m00s");
    }

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize_file_name("赤が/ベント?"), "赤が_ベント_");
        assert_eq!(sanitize_file_name("  kill.  "), "kill");
        assert_eq!(sanitize_file_name("a\u{0007}b"), "a_b");
    }

    #[test]
    fn unique_path_appends_number() {
        let dir = tempfile::tempdir().unwrap();
        let p1 = unique_path(dir.path(), "clip", "mp4");
        assert_eq!(p1.file_name().unwrap(), "clip.mp4");
        std::fs::write(&p1, b"x").unwrap();
        let p2 = unique_path(dir.path(), "clip", "mp4");
        assert_eq!(p2.file_name().unwrap(), "clip (2).mp4");
    }

    #[test]
    fn discord_bitrate_fits_target() {
        // 20 秒・10MB: (10*8000/20*0.9) = 3600kbps → 音声 128k、映像 3472k / 720p
        let (v, a, h, fps) = discord_params(20.0, 10.0);
        assert_eq!((v, a, h, fps), (3472, 128, 720, None));
        let est_mb = (v + a) as f64 * 20.0 / 8000.0;
        assert!(est_mb < 10.0);
        // 長いクリップは 480p/30fps まで落とす
        let (_, _, h, fps) = discord_params(120.0, 10.0);
        assert_eq!((h, fps), (480, Some(30)));
    }

    #[test]
    fn fast_mode_copies_streams() {
        let a = build_args(ClipMode::Fast, "in.mp4", 10.5, 5.0, "out.mp4", 10.0);
        let s = a.join(" ");
        assert!(s.contains("-ss 10.500 -i in.mp4 -t 5.000"));
        assert!(s.contains("-c copy"));
        assert!(s.ends_with("-movflags +faststart out.mp4"));
    }

    /// 実際に ffmpeg で切り出せるか（ffmpeg が無い環境ではスキップ）
    #[test]
    fn ffmpeg_roundtrip_all_modes() {
        let ff = PathBuf::from(FFMPEG_EXE);
        if command(&ff).arg("-version").output().is_err() {
            eprintln!("ffmpeg not found; skipping");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.mp4");
        let ok = command(&ff)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=60",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440",
                "-t",
                "6",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
            ])
            .arg(&src)
            .status()
            .unwrap()
            .success();
        assert!(ok);
        for mode in [ClipMode::Fast, ClipMode::Quality, ClipMode::Discord] {
            let out = dir.path().join(format!("{mode:?}.mp4"));
            let args = build_args(
                mode,
                src.to_str().unwrap(),
                1.0,
                2.0,
                out.to_str().unwrap(),
                10.0,
            );
            let st = command(&ff)
                .args(&args)
                .stdout(Stdio::null())
                .status()
                .unwrap();
            assert!(st.success(), "{mode:?} failed");
            assert!(std::fs::metadata(&out).unwrap().len() > 1000);
        }
    }
}
