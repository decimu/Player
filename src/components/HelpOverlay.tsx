import { useEffect } from "react";

const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: "見る",
    keys: [
      ["Space / K", "再生 / 一時停止"],
      ["← / →", "5 秒戻る / 進む（設定で変えられます）"],
      ["Shift + ← / →", "1 秒戻る / 進む"],
      ["J / L", "10 秒戻る / 進む"],
      [", / .", "1 コマ戻す / 送る"],
      ["[ / ]", "遅くする / 速くする"],
      ["0 〜 9", "0% 〜 90% の位置へ"],
      ["Home / End", "最初 / 最後へ"],
      ["↑ / ↓ / M", "音量 / ミュート"],
      ["F / ダブルクリック", "全画面（Esc で戻る）"],
      ["R", "動画を読み直す"],
    ],
  },
  {
    title: "切り抜き・しるし",
    keys: [
      ["I / O", "今の位置を「ここから」/「ここまで」に"],
      ["Shift + I / O", "「ここから」/「ここまで」へ移動"],
      ["Q", "直前 15 秒を範囲にする"],
      ["X", "範囲を消す"],
      ["E / Enter", "切り抜く"],
      ["B", "今の位置にしるし"],
      ["N / Shift + N", "次 / 前のしるしへ"],
      ["?", "この一覧"],
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
      <div className="modal panel help" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header>
          <h2 id="help-title">キー操作</h2>
          <button className="btn small" onClick={onClose} autoFocus>
            閉じる
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
