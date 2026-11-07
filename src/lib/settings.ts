import { useCallback, useState } from "react";
import type { ClipMode } from "./api";

export type Settings = {
  /** OBS の録画フォルダ */
  folder: string | null;
  /** クリップの保存先。null なら 録画フォルダ/clips */
  clipDir: string | null;
  /** ffmpeg の場所。空なら自動で探す */
  ffmpegPath: string;
  /** 新しい録画ができたら自動で開く */
  autoOpen: boolean;
  /** 自動で開いたとき再生を始める */
  autoPlay: boolean;
  clipMode: ClipMode;
  /** Discord モードの上限サイズ (MB) */
  discordMb: number;
  /** ← → で飛ぶ秒数 */
  skipSec: number;
  volume: number;
  muted: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  folder: null,
  clipDir: null,
  ffmpegPath: "",
  autoOpen: true,
  autoPlay: true,
  clipMode: "fast",
  discordMb: 10,
  skipSec: 5,
  volume: 1,
  muted: false,
};

const KEY = "replay-player.settings.v1";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* 読めなければ既定値 */
  }
  return DEFAULT_SETTINGS;
}

function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 保存できなくても動作は続ける */
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(load);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);
  return [settings, update];
}

// ---- ファイルごとのマーカー ----

const MARKER_KEY = (path: string) => `replay-player.markers:${path}`;

export function loadMarkers(path: string): number[] {
  try {
    const raw = localStorage.getItem(MARKER_KEY(path));
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === "number") : [];
  } catch {
    return [];
  }
}

export function saveMarkers(path: string, markers: number[]) {
  try {
    if (markers.length) localStorage.setItem(MARKER_KEY(path), JSON.stringify(markers));
    else localStorage.removeItem(MARKER_KEY(path));
  } catch {
    /* noop */
  }
}
