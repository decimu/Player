import { invoke } from "@tauri-apps/api/core";

export type VideoFile = {
  path: string;
  name: string;
  size: number;
  /** 最終更新（ミリ秒） */
  modified: number;
};

export type ClipMode = "fast" | "quality" | "discord";

export type ClipRequest = {
  jobId: number;
  input: string;
  start: number;
  end: number;
  mode: ClipMode;
  outputDir: string;
  name?: string;
  ffmpegPath?: string;
  targetMb?: number;
};

export type ClipResult = { path: string; size: number };
export type FfmpegInfo = { path: string; version: string };
export type ClipProgress = { jobId: number; ratio: number };

export const api = {
  listVideos: (dir: string) => invoke<VideoFile[]>("list_videos", { dir }),
  openExternalFile: (path: string) => invoke<VideoFile>("open_external_file", { path }),
  copyFileToClipboard: (path: string) => invoke<void>("copy_file_to_clipboard", { path }),
  checkFfmpeg: (customPath?: string) => invoke<FfmpegInfo>("check_ffmpeg", { customPath: customPath || null }),
  exportClip: (req: ClipRequest) => invoke<ClipResult>("export_clip", { req }),
  cancelClip: (jobId: number) => invoke<void>("cancel_clip", { jobId }),
};

let mediaBase = "";

/** 起動時に 1 回、アプリ内の動画サーバーの URL を受け取る */
export async function initMedia() {
  mediaBase = await invoke<string>("media_base");
}

/** ローカルファイルを <video> で読める URL にする（127.0.0.1 の動画サーバー経由） */
export const fileSrc = (path: string) => mediaBase + encodeURIComponent(path);

/** invoke のエラー（文字列で返ってくる）を表示用の文字列に */
export const errorText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
