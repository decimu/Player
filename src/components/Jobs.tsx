import type { ClipMode, ClipResult } from "../lib/api";
import { baseName, fmtSize } from "../lib/format";
import { Digits } from "./Digits";

export type Job = {
  id: number;
  label: string;
  mode: ClipMode;
  ratio: number;
  status: "running" | "done" | "error";
  result?: ClipResult;
  error?: string;
};

const RUNNING_TEXT: Record<ClipMode, string> = {
  fast: "そのまま切り抜き中",
  quality: "きれいに書き出し中",
  discord: "Discord用に小さくしています",
};

type Props = {
  jobs: Job[];
  limitMb: number;
  onCancel: (id: number) => void;
  onDismiss: (id: number) => void;
  onPlay: (path: string) => void;
  onReveal: (path: string) => void;
  onCopy: (path: string) => void;
};

function doneText(job: Job, limitMb: number): string {
  const size = job.result!.size;
  if (job.mode === "discord") {
    return size <= limitMb * 1000 * 1000
      ? `${fmtSize(size)} なので、Discord にそのまま貼れます`
      : `${fmtSize(size)} で ${limitMb}MB を超えました。範囲を短くしてもう一度どうぞ`;
  }
  return `${fmtSize(size)} ・ ${baseName(job.result!.path)}`;
}

/** 右上に出る切り抜きの進み具合と結果 */
export function Jobs({ jobs, limitMb, onCancel, onDismiss, onPlay, onReveal, onCopy }: Props) {
  if (!jobs.length) return null;
  return (
    <div className="jobs" aria-live="polite">
      {jobs.map((j) => (
        <div key={j.id} className={`job panel ${j.status}`}>
          {j.status === "running" && (
            <>
              <div className="job-head">
                <b className="job-title">{j.label}</b>
                <span className="dim">{RUNNING_TEXT[j.mode]}</span>
              </div>
              <div className="job-row">
                <div className="progress" role="progressbar" aria-valuenow={Math.round(j.ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${Math.round(j.ratio * 100)}%` }} />
                </div>
                <span className="tc">
                  <Digits text={`${Math.round(j.ratio * 100)}%`} />
                </span>
                <button className="btn small" onClick={() => onCancel(j.id)}>
                  やめる
                </button>
              </div>
            </>
          )}

          {j.status === "done" && j.result && (
            <>
              <div className="job-head">
                <b className="job-title">切り抜きました</b>
                <button className="link" onClick={() => onDismiss(j.id)} aria-label="閉じる">
                  ×
                </button>
              </div>
              <p className="dim job-text" title={j.result.path}>
                {doneText(j, limitMb)}
              </p>
              <div className="job-row wrap">
                <button className="btn primary" onClick={() => onCopy(j.result!.path)} title="ファイルとしてコピーします。Discord で Ctrl+V すると貼れます">
                  コピーして Discord へ
                </button>
                <button className="btn" onClick={() => onPlay(j.result!.path)}>
                  見る
                </button>
                <button className="btn" onClick={() => onReveal(j.result!.path)} title="エクスプローラーで表示">
                  フォルダ
                </button>
              </div>
            </>
          )}

          {j.status === "error" && (
            <>
              <div className="job-head">
                <b className="job-title">切り抜けませんでした</b>
                <button className="link" onClick={() => onDismiss(j.id)} aria-label="閉じる">
                  ×
                </button>
              </div>
              <pre className="job-error">{j.error}</pre>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
