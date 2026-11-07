import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, errorText, type FfmpegInfo } from "../lib/api";
import { joinPath } from "../lib/format";
import type { Settings } from "../lib/settings";
import { Icon } from "./Icon";

type Props = {
  settings: Settings;
  updateSettings: (p: Partial<Settings>) => void;
  onPickFolder: () => void;
  onClose: () => void;
  ffmpeg: FfmpegInfo | null;
  ffmpegError: string | null;
  onRecheckFfmpeg: (path: string) => void;
};

export function SettingsDialog({ settings, updateSettings, onPickFolder, onClose, ffmpeg, ffmpegError, onRecheckFfmpeg }: Props) {
  const [ffPath, setFfPath] = useState(settings.ffmpegPath);
  const defaultClipDir = settings.folder ? joinPath(settings.folder, "clips") : "（録画フォルダ）/clips";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickClipDir = async () => {
    const dir = await open({ directory: true, defaultPath: settings.clipDir ?? settings.folder ?? undefined });
    if (typeof dir === "string") updateSettings({ clipDir: dir });
  };

  const pickFfmpeg = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: "ffmpeg", extensions: navigator.userAgent.includes("Windows") ? ["exe"] : ["*"] }],
    });
    if (typeof file === "string") {
      setFfPath(file);
      updateSettings({ ffmpegPath: file });
      onRecheckFfmpeg(file);
    }
  };

  const saveFfPath = () => {
    if (ffPath !== settings.ffmpegPath) {
      updateSettings({ ffmpegPath: ffPath });
      onRecheckFfmpeg(ffPath);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header>
          <h2 id="settings-title">設定</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </header>

        <section>
          <h3>フォルダ</h3>
          <label className="field">
            <span>録画フォルダ</span>
            <div className="path-row">
              <code>{settings.folder ?? "未設定"}</code>
              <button className="ghost small" onClick={onPickFolder}>変更</button>
            </div>
          </label>
          <label className="field">
            <span>クリップの保存先</span>
            <div className="path-row">
              <code>{settings.clipDir ?? defaultClipDir}</code>
              <button className="ghost small" onClick={pickClipDir}>変更</button>
              {settings.clipDir && (
                <button className="ghost small" onClick={() => updateSettings({ clipDir: null })}>既定に戻す</button>
              )}
            </div>
          </label>
        </section>

        <section>
          <h3>新しい録画</h3>
          <label className="check">
            <input type="checkbox" checked={settings.autoOpen} onChange={(e) => updateSettings({ autoOpen: e.target.checked })} />
            <span>
              録画フォルダに新しい動画ができたら自動で開く
              <small>OBS のリプレイバッファ保存や録画の分割と組み合わせると、会議中にすぐ見返せます。</small>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.autoPlay}
              disabled={!settings.autoOpen}
              onChange={(e) => updateSettings({ autoPlay: e.target.checked })}
            />
            <span>自動で開いたらすぐ再生する</span>
          </label>
        </section>

        <section>
          <h3>操作</h3>
          <label className="field inline">
            <span>← → で飛ぶ秒数</span>
            <select value={settings.skipSec} onChange={(e) => updateSettings({ skipSec: Number(e.target.value) })}>
              {[2, 3, 5, 10].map((s) => (
                <option key={s} value={s}>{s} 秒</option>
              ))}
            </select>
          </label>
          <label className="field inline">
            <span>圧縮モードの上限サイズ</span>
            <select value={settings.discordMb} onChange={(e) => updateSettings({ discordMb: Number(e.target.value) })}>
              {[8, 10, 25, 50, 100, 500].map((s) => (
                <option key={s} value={s}>{s} MB</option>
              ))}
            </select>
          </label>
        </section>

        <section>
          <h3>ffmpeg（クリップの書き出しに使います）</h3>
          <div className={`ffmpeg-status ${ffmpeg ? "ok" : "ng"}`}>
            {ffmpeg ? (
              <>
                <b>見つかりました</b>
                <span>{ffmpeg.version}</span>
                <code>{ffmpeg.path}</code>
              </>
            ) : (
              <>
                <b>見つかりません</b>
                <span>{ffmpegError}</span>
                <span>
                  Windows ならコマンドプロンプトで <code>winget install Gyan.FFmpeg</code> を実行して、このアプリを開き直してください。
                  ffmpeg.exe をこのアプリと同じフォルダに置いても使えます。
                </span>
              </>
            )}
          </div>
          <label className="field">
            <span>ffmpeg の場所（空欄なら自動で探す）</span>
            <div className="path-row">
              <input
                value={ffPath}
                placeholder="自動"
                onChange={(e) => setFfPath(e.target.value)}
                onBlur={saveFfPath}
                onKeyDown={(e) => e.key === "Enter" && saveFfPath()}
              />
              <button className="ghost small" onClick={pickFfmpeg}>選ぶ</button>
              <button className="ghost small" onClick={() => onRecheckFfmpeg(ffPath)}>再確認</button>
            </div>
          </label>
        </section>
      </div>
    </div>
  );
}

export async function checkFfmpeg(path: string): Promise<{ info: FfmpegInfo | null; error: string | null }> {
  try {
    return { info: await api.checkFfmpeg(path), error: null };
  } catch (e) {
    return { info: null, error: errorText(e) };
  }
}
