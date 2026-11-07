import { useEffect, useRef, useState } from "react";
import { fmtTime } from "../lib/format";

type Props = {
  src: string | null;
  duration: number;
  current: number;
  inPoint: number | null;
  outPoint: number | null;
  markers: number[];
  onSeek: (t: number) => void;
  onChangeIn: (t: number) => void;
  onChangeOut: (t: number) => void;
};

type Drag = "seek" | "in" | "out";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const PREVIEW_W = 208;

export function Timeline(props: Props) {
  const { src, duration, current, inPoint, outPoint, markers } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [hover, setHover] = useState<{ x: number; width: number; t: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const pct = (t: number) => (duration > 0 ? (clamp(t, 0, duration) / duration) * 100 : 0);

  const measure = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    const x = clamp(clientX - r.left, 0, r.width);
    return { x, width: r.width, t: r.width > 0 ? (x / r.width) * duration : 0 };
  };

  const apply = (clientX: number) => {
    const { t } = measure(clientX);
    switch (drag.current) {
      case "seek":
        props.onSeek(t);
        break;
      case "in":
        props.onChangeIn(outPoint != null ? Math.min(t, outPoint - 0.1) : t);
        break;
      case "out":
        props.onChangeOut(inPoint != null ? Math.max(t, inPoint + 0.1) : t);
        break;
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!duration || e.button !== 0) return;
    const el = e.target as HTMLElement;
    const marker = el.dataset.marker;
    if (marker != null) {
      props.onSeek(Number(marker));
      return;
    }
    const handle = el.dataset.handle;
    drag.current = handle === "in" ? "in" : handle === "out" ? "out" : "seek";
    setDragging(true);
    trackRef.current!.setPointerCapture(e.pointerId);
    apply(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!duration) return;
    setHover(measure(e.clientX));
    if (drag.current) apply(e.clientX);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    trackRef.current?.releasePointerCapture(e.pointerId);
  };

  const hasRange = inPoint != null || outPoint != null;
  const rangeStart = inPoint ?? 0;
  const rangeEnd = outPoint ?? duration;

  const previewLeft = hover ? clamp(hover.x - PREVIEW_W / 2, 0, Math.max(0, hover.width - PREVIEW_W)) : 0;

  return (
    <div
      className={`timeline ${dragging ? "dragging" : ""}`}
      ref={trackRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => !drag.current && setHover(null)}
    >
      <div className="tl-track">
        {hasRange && (
          <div className="tl-range" style={{ left: `${pct(rangeStart)}%`, width: `${pct(rangeEnd) - pct(rangeStart)}%` }} />
        )}
        <div className="tl-played" style={{ width: `${pct(current)}%` }} />
        {hover && <div className="tl-hoverline" style={{ left: hover.x }} />}
      </div>

      {markers.map((m, i) => (
        <div
          key={`${m}-${i}`}
          className="tl-marker"
          data-marker={m}
          style={{ left: `${pct(m)}%` }}
          title={`マーカー ${fmtTime(m, true)}（クリックで移動）`}
        />
      ))}

      {inPoint != null && <div className="tl-handle in" data-handle="in" style={{ left: `${pct(inPoint)}%` }} title="IN（ドラッグで調整）" />}
      {outPoint != null && <div className="tl-handle out" data-handle="out" style={{ left: `${pct(outPoint)}%` }} title="OUT（ドラッグで調整）" />}

      <div className="tl-head" style={{ left: `${pct(current)}%` }} />

      <div className="tl-preview" style={{ left: previewLeft, visibility: hover && src ? "visible" : "hidden" }}>
        {src && <HoverPreview src={src} t={hover?.t ?? 0} />}
        <span className="tl-preview-time">{fmtTime(hover?.t ?? 0, true)}</span>
      </div>
    </div>
  );
}

/** タイムラインにカーソルを乗せた位置の映像を小さく出す（もう 1 本の <video> をシークさせる） */
function HoverPreview({ src, t }: { src: string; t: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const busySince = useRef<number | null>(null);
  const pending = useRef<number | null>(null);

  const seek = (time: number) => {
    const v = ref.current;
    if (!v) return;
    pending.current = null;
    if (v.readyState < HTMLMediaElement.HAVE_METADATA) {
      // まだ読み込み前。読み込めたらそこへ
      pending.current = time;
      return;
    }
    busySince.current = performance.now();
    v.currentTime = time;
  };

  useEffect(() => {
    // シーク中なら最後の位置だけ覚えておき、終わったらそこへ（大きいファイルでも詰まらないように）
    const busy = busySince.current != null && performance.now() - busySince.current < 1000;
    if (busy) pending.current = t;
    else seek(t);
  }, [t]);

  const flush = () => {
    busySince.current = null;
    if (pending.current != null) seek(pending.current);
  };

  return <video ref={ref} src={src} muted preload="auto" playsInline onSeeked={flush} onLoadedMetadata={flush} />;
}
