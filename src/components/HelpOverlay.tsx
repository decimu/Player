import { useEffect } from "react";
import { Icon } from "./Icon";

const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: "再生",
    keys: [
      ["Space / K", "再生 / 一時停止"],
      ["← / →", "5 秒戻る / 進む（設定で変更可）"],
      ["Shift + ← / →", "1 秒戻る / 進む"],
      ["J / L", "10 秒戻る / 進む"],
      [", / .", "1 コマ戻る / 進む"],
      ["[ / ]", "再生速度を下げる / 上げる"],
      ["0 〜 9", "0% 〜 90% の位置へ"],
      ["Home / End", "先頭 / 末尾へ"],
      ["↑ / ↓ / M", "音量 / ミュート"],
      ["F / ダブルクリック", "全画面"],
      ["R", "動画を再読み込み"],
    ],
  },
  {
    title: "クリップ・マーカー",
    keys: [
      ["I / O", "今の位置を開始 / 終了にする"],
      ["Shift + I / O", "開始 / 終了の位置へ移動"],
      ["Q", "直前 15 秒を範囲にする"],
      ["X", "範囲をクリア"],
      ["E / Enter", "書き出し"],
      ["B", "今の位置にマーカー"],
      ["N / Shift + N", "次 / 前のマーカーへ"],
    ],
  },
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal help" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header>
          <h2 id="help-title">ショートカット</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            <Icon name="close" />
          </button>
        </header>
        <div className="help-grid">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <dl>
                {s.keys.map(([k, d]) => (
                  <div key={k}>
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{d}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
