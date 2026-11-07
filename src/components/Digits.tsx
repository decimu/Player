/**
 * 数字を 1 文字ずつ同じ幅の枠に入れて表示する。
 * LINE Seed JP は数字の幅が文字ごとに違い、幅をそろえる機能（tnum）もないので、
 * 再生中に変わり続ける時刻がぶれないようにするため。
 */
export function Digits({ text }: { text: string }) {
  return (
    <>
      {Array.from(text).map((c, i) =>
        c >= "0" && c <= "9" ? (
          <span key={i} className="digit">
            {c}
          </span>
        ) : (
          c
        ),
      )}
    </>
  );
}
