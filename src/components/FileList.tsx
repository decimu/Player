import { useEffect, useState } from "react";
import type { VideoFile } from "../lib/api";
import { baseName, dayLabel, fmtAgo, fmtClock, fmtSize, recordingLabel, stripExt } from "../lib/format";

export type Tab = "rec" | "clips";

type Props = {
  tab: Tab;
  onTab: (t: Tab) => void;
  folder: string | null;
  recordings: VideoFile[];
  clips: VideoFile[];
  writing: Set<string>;
  currentPath: string | null;
  loaded: boolean;
  error: string | null;
  ffmpegMissing: boolean;
  onPickFolder: () => void;
  onOpen: (f: VideoFile) => void;
  onOpenSettings: () => void;
  onShowHelp: () => void;
};

/** 30 秒ごとに再描画して「3分前」を更新する */
function useTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
}

export function FileList(props: Props) {
  const { tab, onTab, folder, recordings, clips, writing, currentPath, loaded, error } = props;
  useTick();
  const isRec = tab === "rec";
  const all = isRec ? recordings : clips;
  // 書き込み中のファイルは一覧の先頭に別枠で出す
  const busy = isRec ? all.filter((f) => writing.has(f.path)) : [];
  const files = isRec ? all.filter((f) => !writing.has(f.path)) : all;

  const groups: { label: string; items: VideoFile[] }[] = [];
  for (const f of files) {
    const label = dayLabel(f.modified);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(f);
    else groups.push({ label, items: [f] });
  }

  return (
    <aside className="sidebar panel">
      <div className="side-head">
        <span className="wordmark">Replay Player</span>
        <button className="btn small" onClick={props.onOpenSettings}>
          設定
        </button>
      </div>

      <div className="seg seg-full" role="tablist" aria-label="一覧の切り替え">
        <button role="tab" aria-selected={isRec} className={isRec ? "on" : ""} onClick={() => onTab("rec")}>
          録画 {recordings.length}
        </button>
        <button role="tab" aria-selected={!isRec} className={!isRec ? "on" : ""} onClick={() => onTab("clips")}>
          切り抜き {clips.length}
        </button>
      </div>

      <div className="file-scroll">
        {!folder && (
          <div className="empty">
            <p>OBS の録画フォルダを選んでください。</p>
            <p className="dim">OBS の「設定 → 出力 → 録画 → 録画ファイルのパス」に出ているフォルダです。</p>
            <button className="btn primary" onClick={props.onPickFolder}>
              フォルダを選ぶ
            </button>
          </div>
        )}

        {folder && error && (
          <div className="empty error-box" role="alert">
            <p>一覧を読めませんでした。</p>
            <p className="dim small-text">{error}</p>
            <button className="btn" onClick={props.onPickFolder}>
              フォルダを選び直す
            </button>
          </div>
        )}

        {folder && !error && !loaded && <p className="empty dim">読み込み中…</p>}

        {folder && !error && loaded && all.length === 0 && (
          <div className="empty">
            {isRec ? (
              <p className="dim">まだ録画がありません。OBS で録画やリプレイ保存をするとここに出てきます。</p>
            ) : (
              <p className="dim">まだ切り抜きはありません。動画で I と O を押して範囲を決め、「切り抜く」を押すとここに入ります。</p>
            )}
          </div>
        )}

        {busy.map((f) => (
          <button key={f.path} className="busy-row" onClick={() => props.onOpen(f)} title={f.path}>
            <span className="rec-dot" aria-hidden="true" />
            <span className="busy-text">
              <b>いま録画中</b>
              <span className="dim">止めるか分割すると見られます</span>
            </span>
          </button>
        ))}

        {groups.map((g) => (
          <section key={g.label}>
            <h3 className="day">{g.label}</h3>
            <ul className="files">
              {g.items.map((f) => {
                const current = f.path === currentPath;
                const ago = fmtAgo(f.modified);
                return (
                  <li key={f.path}>
                    {isRec ? (
                      <button className={`file ${current ? "current" : ""}`} onClick={() => props.onOpen(f)} title={f.name} aria-current={current}>
                        <span className="tc file-time">{fmtClock(f.modified)}</span>
                        <span className="file-name">{recordingLabel(f.name)}</span>
                        <span className={current ? "now" : "dim small-text"}>{current ? "見てる" : ago ?? fmtSize(f.size)}</span>
                      </button>
                    ) : (
                      <button className={`file clip ${current ? "current" : ""}`} onClick={() => props.onOpen(f)} title={f.name} aria-current={current}>
                        <span className="file-name">{stripExt(f.name)}</span>
                        <span className="dim small-text">
                          {fmtClock(f.modified)} ・ {fmtSize(f.size)}
                          {current && <span className="now"> ・ 見てる</span>}
                        </span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <footer className="side-foot">
        {props.ffmpegMissing && (
          <button className="link warn-text" onClick={props.onOpenSettings}>
            ffmpeg が見つかりません（切り抜きに必要です）
          </button>
        )}
        <div className="side-foot-row">
          {folder && (
            <button className="link folder-link" onClick={props.onPickFolder} title={`${folder}（クリックで変える）`}>
              {baseName(folder.replace(/[\\/]+$/, "")) || folder}
            </button>
          )}
          <button className="link" onClick={props.onShowHelp}>
            キー操作 <kbd>?</kbd>
          </button>
        </div>
      </footer>
    </aside>
  );
}
