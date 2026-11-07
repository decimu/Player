import { useEffect, useState, type ReactNode } from "react";
import type { VideoFile } from "../lib/api";
import { baseName, dayLabel, fmtAgo, fmtClock, fmtSize, stripExt } from "../lib/format";
import { Icon } from "./Icon";

export type Tab = "rec" | "clips";

type Props = {
  tab: Tab;
  onTab: (t: Tab) => void;
  folder: string | null;
  recordings: VideoFile[];
  clips: VideoFile[];
  writing: Set<string>;
  currentPath: string | null;
  error: string | null;
  onPickFolder: () => void;
  onRefresh: () => void;
  onOpen: (f: VideoFile) => void;
  footer?: ReactNode;
};

/** 1 分ごとに再描画して「3分前」を更新する */
function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
}

export function FileList(props: Props) {
  const { tab, onTab, folder, recordings, clips, writing, currentPath, error } = props;
  useMinuteTick();
  const files = tab === "rec" ? recordings : clips;

  const groups: { label: string; items: VideoFile[] }[] = [];
  for (const f of files) {
    const label = dayLabel(f.modified);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(f);
    else groups.push({ label, items: [f] });
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <button className="folder-btn" onClick={props.onPickFolder} title={folder ?? "録画フォルダを選ぶ"}>
          <Icon name="folder" />
          <span className="folder-path">{folder ? baseName(folder.replace(/[\\/]+$/, "")) || folder : "録画フォルダを選ぶ"}</span>
        </button>
        <button className="icon-btn" onClick={props.onRefresh} title="一覧を更新" disabled={!folder}>
          <Icon name="refresh" />
        </button>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "rec"} className={tab === "rec" ? "active" : ""} onClick={() => onTab("rec")}>
          録画 <span className="count">{recordings.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "clips"} className={tab === "clips" ? "active" : ""} onClick={() => onTab("clips")}>
          クリップ <span className="count">{clips.length}</span>
        </button>
      </div>

      <div className="file-scroll">
        {error && <div className="list-error">{error}</div>}

        {!folder && (
          <div className="empty">
            <p>OBS の録画フォルダを選んでください。</p>
            <p className="hint">OBS の「設定 → 出力 → 録画 → 録画ファイルのパス」に出ているフォルダです。</p>
            <button className="primary" onClick={props.onPickFolder}>
              <Icon name="folder" /> フォルダを選ぶ
            </button>
          </div>
        )}

        {folder && files.length === 0 && !error && (
          <div className="empty">
            {tab === "rec" ? (
              <p>まだ録画がありません。OBS で録画するとここに出てきます。</p>
            ) : (
              <p>クリップはまだありません。動画で I / O を押して範囲を決め、書き出してください。</p>
            )}
          </div>
        )}

        {groups.map((g) => (
          <section key={g.label}>
            <h3 className="day">{g.label}</h3>
            <ul className="files">
              {g.items.map((f) => {
                const isWriting = writing.has(f.path);
                const ago = fmtAgo(f.modified);
                return (
                  <li key={f.path}>
                    <button
                      className={`file ${f.path === currentPath ? "current" : ""} ${isWriting ? "writing" : ""}`}
                      onClick={() => props.onOpen(f)}
                      title={f.path}
                    >
                      <span className="file-time">{fmtClock(f.modified)}</span>
                      <span className="file-body">
                        <span className="file-name">{stripExt(f.name)}</span>
                        <span className="file-meta">
                          {isWriting ? (
                            <span className="badge rec">
                              <Icon name="rec" size={10} /> 書き込み中
                            </span>
                          ) : (
                            <>
                              {fmtSize(f.size)}
                              {ago && <span className="ago">・{ago}</span>}
                            </>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {props.footer}
    </aside>
  );
}
