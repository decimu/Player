import type { ClipMode, ClipResult } from "../lib/api";
import { baseName, fmtSize } from "../lib/format";
import { Icon } from "./Icon";

export type Job = {
  id: number;
  label: string;
  mode: ClipMode;
  ratio: number;
  status: "running" | "done" | "error";
  result?: ClipResult;
  error?: string;
};

const MODE_LABEL: Record<ClipMode, string> = { fast: "高速", quality: "高画質", discord: "圧縮" };

type Props = {
  jobs: Job[];
  onCancel: (id: number) => void;
  onDismiss: (id: number) => void;
  onPlay: (path: string) => void;
  onReveal: (path: string) => void;
  onCopy: (path: string) => void;
};

/** 右下に出る書き出しジョブの一覧 */
export function Jobs({ jobs, onCancel, onDismiss, onPlay, onReveal, onCopy }: Props) {
  if (!jobs.length) return null;
  return (
    <div className="jobs">
      {jobs.map((j) => (
        <div key={j.id} className={`job ${j.status}`}>
          <div className="job-head">
            <Icon name="scissors" size={14} />
            <span className="job-label" title={j.result?.path ?? j.label}>
              {j.result ? baseName(j.result.path) : j.label}
            </span>
            <span className="job-mode">{MODE_LABEL[j.mode]}</span>
            {j.status !== "running" && (
              <button className="icon-btn tiny" onClick={() => onDismiss(j.id)} aria-label="閉じる">
                <Icon name="close" size={14} />
              </button>
            )}
          </div>

          {j.status === "running" && (
            <div className="job-body">
              <div className="progress">
                <div style={{ width: `${Math.round(j.ratio * 100)}%` }} />
              </div>
              <span className="dim">{Math.round(j.ratio * 100)}%</span>
              <button className="link" onClick={() => onCancel(j.id)}>キャンセル</button>
            </div>
          )}

          {j.status === "done" && j.result && (
            <div className="job-body">
              <span className="ok">完了 {fmtSize(j.result.size)}</span>
              <button className="link" onClick={() => onPlay(j.result!.path)}>再生</button>
              <button className="link" onClick={() => onCopy(j.result!.path)} title="Discord などに Ctrl+V で貼れます">コピー</button>
              <button className="link" onClick={() => onReveal(j.result!.path)}>フォルダ</button>
            </div>
          )}

          {j.status === "error" && <pre className="job-error">{j.error}</pre>}
        </div>
      ))}
    </div>
  );
}
