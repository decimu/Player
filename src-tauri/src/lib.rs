mod ffmpeg;
mod files;
mod media;

use std::sync::Arc;
use tauri::State;

/// 動画の URL の先頭部分。`base + encodeURIComponent(フルパス)` で再生できる
#[tauri::command]
fn media_base(media: State<Arc<media::MediaServer>>) -> String {
    media.base_url().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ffmpeg::Jobs::default())
        .manage(media::MediaServer::start().expect("動画サーバーを起動できません"))
        .invoke_handler(tauri::generate_handler![
            media_base,
            files::list_videos,
            files::open_external_file,
            files::copy_file_to_clipboard,
            ffmpeg::check_ffmpeg,
            ffmpeg::export_clip,
            ffmpeg::cancel_clip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
