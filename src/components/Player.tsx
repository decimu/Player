import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileSrc, type ClipMode, type VideoFile } from "../lib/api";
import { fmtDuration, fmtSize, fmtTime, stripExt } from "../lib/format";
import { loadMarkers, saveMarkers, type Settings } from "../lib/settings";
import { Icon } from "./Icon";
import { Timeline } from "./Timeline";

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const QUICK_CLIP_SEC = 15;

export type ExportRequest = { start: number; end: number; mode: ClipMode; name: string };

type Props = {
  file: VideoFile | null;
  autoPlay: boolean;
  writing: boolean;
  isClip: boolean;
  settings: Settings;
  updateSettings: (p: Partial<Settings>) => void;
  keyboardEnabled: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onExport: (req: ExportRequest) => void;
  onReveal: (path: string) => void;
  onCopyFile: (path: string) => void;
  onShowHelp: () => void;
  onNotice: (text: string) => void;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function errorMessage(err: MediaError | null, writing: boolean): string {
  if (writing) return "OBS がまだ書き込み中のため再生できません。録画を止めるか分割すると見られるようになります（R で再読み込み）。";
  switch (err?.code) {
    case MediaError.MEDIA_ERR_DECODE:
      return "映像をデコードできませんでした。HEVC / AV1 で録画している場合、PC によっては再生できません。";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "この形式は再生できません。録画中のファイルか、コンテナ / コーデックが未対応の可能性があります（mkv は OBS の「録画の再多重化」で mp4 にできます）。";
    default:
      return "動画を読み込めませんでした。";
  }
}

export function Player(props: Props) {
  const { file, settings, writing } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);
  const [markers, setMarkers] = useState<number[]>([]);
  const [clipName, setClipName] = useState("");
  const [osd, setOsd] = useState<{ text: string; key: number } | null>(null);
  const frameDur = useRef(1 / 60);
  const resumeAt = useRef<number | null>(null);
  const autoPlayRef = useRef(false);

  const src = useMemo(() => (file ? fileSrc(file.path) + (reloadKey ? `?r=${reloadKey}` : "") : null), [file, reloadKey]);

  // ファイルが変わったら範囲・マーカーなどをリセット
  useEffect(() => {
    setInPoint(null);
    setOutPoint(null);
    setClipName("");
    setError(null);
    setCurrent(0);
    setDuration(0);
    setReloadKey(0);
    resumeAt.current = null;
    frameDur.current = 1 / 60;
    autoPlayRef.current = props.autoPlay;
    setMarkers(file ? loadMarkers(file.path) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path]);

  // 音量
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = settings.volume;
    v.muted = settings.muted;
  }, [settings.volume, settings.muted, src]);

  // 再生中はフレームごとに再生位置を更新（timeupdate だけだとカクつく）
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v) setCurrent(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // 1 フレームの長さを実測（30fps / 60fps 録画どちらでもコマ送りが 1 コマになるように）
  useEffect(() => {
    const v = videoRef.current as (HTMLVideoElement & { requestVideoFrameCallback?: Function; cancelVideoFrameCallback?: Function }) | null;
    if (!v || !v.requestVideoFrameCallback || !playing) return;
    let last = -1;
    let measured = Infinity;
    let handle = 0;
    const cb = (_now: number, meta: { mediaTime: number }) => {
      if (last >= 0) {
        const d = meta.mediaTime - last;
        // 倍速再生中はコマが飛ぶので測らない。最小の間隔 = 1 コマ
        if (d > 0.004 && d < 0.1 && v.playbackRate <= 1 && d < measured) {
          measured = d;
          frameDur.current = d;
        }
      }
      last = meta.mediaTime;
      handle = v.requestVideoFrameCallback!(cb);
    };
    handle = v.requestVideoFrameCallback(cb);
    return () => v.cancelVideoFrameCallback?.(handle);
  }, [playing, src]);

  const flash = useCallback((text: string) => setOsd({ text, key: Math.random() }), []);
  useEffect(() => {
    if (!osd) return;
    const t = window.setTimeout(() => setOsd(null), 700);
    return () => window.clearTimeout(t);
  }, [osd]);

  // ---- 操作 ----

  const seekTo = useCallback(
    (t: number) => {
      const v = videoRef.current;
      if (!v || !duration) return;
      const nt = clamp(t, 0, duration);
      v.currentTime = nt;
      setCurrent(nt);
    },
    [duration],
  );

  const seekBy = useCallback((d: number) => {
    const v = videoRef.current;
    if (!v) return;
    seekTo(v.currentTime + d);
  }, [seekTo]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    if (v.paused || v.ended) v.play().catch(() => {});
    else v.pause();
  }, [src]);

  const stepFrame = (dir: 1 | -1) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    seekTo(v.currentTime + dir * frameDur.current);
  };

  const applyRate = (r: number) => {
    const v = videoRef.current;
    if (v) {
      v.playbackRate = r;
      v.defaultPlaybackRate = r;
    }
    setRate(r);
    flash(`${r}x`);
  };

  const changeRate = (dir: 1 | -1) => {
    const idx = RATES.indexOf(rate);
    const next = RATES[clamp((idx < 0 ? RATES.indexOf(1) : idx) + dir, 0, RATES.length - 1)];
    applyRate(next);
  };

  const now = () => videoRef.current?.currentTime ?? current;

  const markIn = (t = now()) => {
    setInPoint(t);
    if (outPoint != null && outPoint <= t) setOutPoint(null);
    flash(`IN ${fmtTime(t, true)}`);
  };
  const markOut = (t = now()) => {
    setOutPoint(t);
    if (inPoint != null && inPoint >= t) setInPoint(null);
    flash(`OUT ${fmtTime(t, true)}`);
  };
  const quickClip = () => {
    const t = now();
    if (t < 0.5) return;
    setInPoint(Math.max(0, t - QUICK_CLIP_SEC));
    setOutPoint(t);
    flash(`直前${QUICK_CLIP_SEC}秒`);
  };
  const clearRange = () => {
    setInPoint(null);
    setOutPoint(null);
  };

  const updateMarkers = (next: number[]) => {
    setMarkers(next);
    if (file) saveMarkers(file.path, next);
  };
  const addMarker = () => {
    const t = now();
    if (markers.some((m) => Math.abs(m - t) < 0.3)) return;
    updateMarkers([...markers, t].sort((a, b) => a - b));
    flash("マーカー");
  };
  const jumpMarker = (dir: 1 | -1) => {
    const t = now();
    const target = dir > 0 ? markers.find((m) => m > t + 0.3) : [...markers].reverse().find((m) => m < t - 0.3);
    if (target != null) seekTo(target);
  };

  const range = inPoint != null || outPoint != null ? { start: inPoint ?? 0, end: outPoint ?? duration } : null;
  const rangeLen = range ? range.end - range.start : 0;

  const doExport = () => {
    if (!file) return;
    if (!range || rangeLen < 0.1) {
      props.onNotice("I（開始）と O（終了）で切り出す範囲を決めてください");
      return;
    }
    props.onExport({ start: range.start, end: range.end, mode: settings.clipMode, name: clipName.trim() });
  };

  const reload = () => {
    resumeAt.current = now();
    autoPlayRef.current = !videoRef.current?.paused;
    setError(null);
    setReloadKey(Date.now());
  };

  const setVolume = (v: number) => props.updateSettings({ volume: clamp(Math.round(v * 100) / 100, 0, 1), muted: false });

  // ---- キーボード ----

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (!props.keyboardEnabled || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;

    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const handled = (() => {
      switch (k) {
        case " ":
        case "k":
          togglePlay();
          return true;
        case "ArrowLeft":
          seekBy(-(e.shiftKey ? 1 : settings.skipSec));
          return true;
        case "ArrowRight":
          seekBy(e.shiftKey ? 1 : settings.skipSec);
          return true;
        case "j":
          seekBy(-10);
          return true;
        case "l":
          seekBy(10);
          return true;
        case ",":
        case "<":
          stepFrame(-1);
          return true;
        case ".":
        case ">":
          stepFrame(1);
          return true;
        case "[":
        case "{":
          changeRate(-1);
          return true;
        case "]":
        case "}":
          changeRate(1);
          return true;
        case "ArrowUp":
          setVolume(settings.volume + 0.1);
          flash(`音量 ${Math.round(Math.min(1, settings.volume + 0.1) * 100)}%`);
          return true;
        case "ArrowDown":
          setVolume(settings.volume - 0.1);
          flash(`音量 ${Math.round(Math.max(0, settings.volume - 0.1) * 100)}%`);
          return true;
        case "m":
          props.updateSettings({ muted: !settings.muted });
          return true;
        case "f":
          props.onToggleFullscreen();
          return true;
        case "Escape":
          if (props.fullscreen) props.onToggleFullscreen();
          return props.fullscreen;
        case "i":
          if (e.shiftKey) inPoint != null && seekTo(inPoint);
          else markIn();
          return true;
        case "o":
          if (e.shiftKey) outPoint != null && seekTo(outPoint);
          else markOut();
          return true;
        case "x":
          clearRange();
          return true;
        case "q":
          quickClip();
          return true;
        case "b":
          addMarker();
          return true;
        case "n":
          jumpMarker(e.shiftKey ? -1 : 1);
          return true;
        case "e":
        case "Enter":
          doExport();
          return true;
        case "r":
          reload();
          return true;
        case "Home":
          seekTo(0);
          return true;
        case "End":
          seekTo(duration - 0.05);
          return true;
        case "?":
          props.onShowHelp();
          return true;
      }
      if (/^[0-9]$/.test(k)) {
        seekTo((Number(k) / 10) * duration);
        return true;
      }
      return false;
    })();
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ---- 動画イベント ----

  const onLoadedMetadata = () => {
    const v = videoRef.current!;
    setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    v.playbackRate = rate;
    v.defaultPlaybackRate = rate;
    if (resumeAt.current != null) {
      v.currentTime = Math.min(resumeAt.current, v.duration || resumeAt.current);
      resumeAt.current = null;
    }
    setCurrent(v.currentTime);
    if (autoPlayRef.current) {
      autoPlayRef.current = false;
      v.play().catch(() => {});
    }
  };

  if (!file) {
    return (
      <main className="player empty-player">
        <div className="placeholder">
          <Icon name="play" size={48} />
          <p>左の一覧から録画を選んでください</p>
          <p className="hint">動画ファイルをウィンドウにドラッグ＆ドロップしても開けます。</p>
          <button className="ghost" onClick={props.onShowHelp}>
            <Icon name="help" /> ショートカット一覧（?）
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={`player ${props.fullscreen ? "fullscreen" : ""}`}>
      {!props.fullscreen && (
        <header className="player-head">
          <div className="title">
            <span className="name" title={file.path}>{stripExt(file.name)}</span>
            <span className="meta">
              {fmtSize(file.size)}
              {duration > 0 && ` ・ ${fmtTime(duration)}`}
            </span>
          </div>
          <div className="head-actions">
            {props.isClip && (
              <button className="ghost small" onClick={() => props.onCopyFile(file.path)} title="ファイルをコピー（Discord などに Ctrl+V で貼れます）">
                <Icon name="copy" size={16} /> コピー
              </button>
            )}
            <button className="ghost small" onClick={() => props.onReveal(file.path)} title="エクスプローラーで表示">
              <Icon name="reveal" size={16} /> フォルダで表示
            </button>
          </div>
        </header>
      )}

      <div className="stage" onDoubleClick={props.onToggleFullscreen}>
        <video
          ref={videoRef}
          src={src ?? undefined}
          preload="auto"
          playsInline
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            setCurrent(videoRef.current?.currentTime ?? 0);
          }}
          onEnded={() => setPlaying(false)}
          onSeeked={() => setCurrent(videoRef.current?.currentTime ?? 0)}
          onTimeUpdate={() => !playing && setCurrent(videoRef.current?.currentTime ?? 0)}
          onLoadedMetadata={onLoadedMetadata}
          onDurationChange={() => {
            const d = videoRef.current?.duration;
            if (d && Number.isFinite(d)) setDuration(d);
          }}
          onError={() => {
            const err = videoRef.current?.error ?? null;
            setError(errorMessage(err, writing));
            setErrorDetail(err?.message || null);
          }}
        />
        {error && (
          <div className="stage-error">
            <p>{error}</p>
            {errorDetail && <small className="error-detail">{errorDetail}</small>}
            <button className="ghost" onClick={reload}>
              <Icon name="refresh" /> 再読み込み
            </button>
          </div>
        )}
        {!error && writing && (
          <div className="stage-banner">
            <Icon name="rec" size={12} /> OBS が書き込み中のファイルです。
            <button className="link" onClick={reload}>再読み込み（R）</button>
          </div>
        )}
        {osd && (
          <div className="osd" key={osd.key}>
            {osd.text}
          </div>
        )}
      </div>

      <div className="controls">
        <Timeline
          src={src}
          duration={duration}
          current={current}
          inPoint={inPoint}
          outPoint={outPoint}
          markers={markers}
          onSeek={seekTo}
          onChangeIn={(t) => {
            setInPoint(t);
            seekTo(t);
          }}
          onChangeOut={(t) => {
            setOutPoint(t);
            seekTo(t);
          }}
        />

        <div className="control-row">
          <div className="group">
            <button className="icon-btn" onClick={() => seekBy(-settings.skipSec)} title={`${settings.skipSec}秒戻る（←）`}>
              <Icon name="back" />
            </button>
            <button className="icon-btn play" onClick={togglePlay} title="再生 / 一時停止（Space）">
              <Icon name={playing ? "pause" : "play"} size={22} />
            </button>
            <button className="icon-btn" onClick={() => seekBy(settings.skipSec)} title={`${settings.skipSec}秒進む（→）`}>
              <Icon name="forward" />
            </button>
            <button className="icon-btn" onClick={() => stepFrame(-1)} title="1コマ戻る（,）">
              <Icon name="frameBack" />
            </button>
            <button className="icon-btn" onClick={() => stepFrame(1)} title="1コマ進む（.）">
              <Icon name="frameForward" />
            </button>
            <span className="time">
              {fmtTime(current, true)} <span className="dim">/ {fmtTime(duration)}</span>
            </span>
          </div>

          <div className="group">
            <div className="rates" title="再生速度（[ ]）">
              {[0.25, 0.5, 1, 1.5, 2, 4].map((r) => (
                <button key={r} className={rate === r ? "active" : ""} onClick={() => applyRate(r)}>
                  {r}x
                </button>
              ))}
              {![0.25, 0.5, 1, 1.5, 2, 4].includes(rate) && <span className="rate-extra">{rate}x</span>}
            </div>
            <button className="icon-btn" onClick={() => props.updateSettings({ muted: !settings.muted })} title="ミュート（M）">
              <Icon name={settings.muted || settings.volume === 0 ? "mute" : "volume"} />
            </button>
            <input
              className="volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={settings.muted ? 0 : settings.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="音量"
            />
            <button className="icon-btn" onClick={props.onToggleFullscreen} title="全画面（F）">
              <Icon name={props.fullscreen ? "exitFullscreen" : "fullscreen"} />
            </button>
          </div>
        </div>

        <div className="clip-row">
          <div className="group">
            <button className="pill in" onClick={() => markIn()} title="今の位置を開始点に（I）／ Shift+I で移動">
              IN <b>{inPoint != null ? fmtTime(inPoint, true) : "--:--"}</b>
            </button>
            <button className="pill out" onClick={() => markOut()} title="今の位置を終了点に（O）／ Shift+O で移動">
              OUT <b>{outPoint != null ? fmtTime(outPoint, true) : "--:--"}</b>
            </button>
            <span className="dim range-len">{range ? fmtDuration(rangeLen) : "範囲なし"}</span>
            <button className="ghost small" onClick={quickClip} title={`直前${QUICK_CLIP_SEC}秒を範囲にする（Q）`}>
              <Icon name="rewind15" size={16} /> 直前{QUICK_CLIP_SEC}秒
            </button>
            {range && (
              <button className="ghost small" onClick={clearRange} title="範囲をクリア（X）">
                <Icon name="close" size={14} /> クリア
              </button>
            )}
          </div>

          <div className="group">
            <div className="segmented" role="radiogroup" aria-label="書き出し方法">
              {(
                [
                  ["fast", "高速", "再エンコードせず一瞬で切り出し。開始が少し前にずれることがあります"],
                  ["quality", "高画質", "再エンコードしてフレーム単位で正確に切り出し"],
                  ["discord", `${settings.discordMb}MB以下`, `Discord に貼れるよう ${settings.discordMb}MB 以下に圧縮`],
                ] as const
              ).map(([mode, label, title]) => (
                <button
                  key={mode}
                  role="radio"
                  aria-checked={settings.clipMode === mode}
                  className={settings.clipMode === mode ? "active" : ""}
                  onClick={() => props.updateSettings({ clipMode: mode })}
                  title={title}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              className="clip-name"
              placeholder="クリップ名（省略可）"
              value={clipName}
              onChange={(e) => setClipName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doExport();
                if (e.key === "Escape") (e.target as HTMLInputElement).blur();
              }}
            />
            <button className="primary" onClick={doExport} disabled={!range} title="クリップを書き出す（E）">
              <Icon name="scissors" /> 書き出し
            </button>
          </div>
        </div>

        <div className="marker-row">
          <button className="ghost small" onClick={addMarker} title="今の位置にマーカー（B）。N / Shift+N で次 / 前へ">
            <Icon name="marker" size={14} /> マーカー
          </button>
          {markers.length === 0 ? (
            <span className="dim">気になった場面で B を押すと印を付けられます</span>
          ) : (
            markers.map((m, i) => (
              <span key={`${m}-${i}`} className="chip">
                <button onClick={() => seekTo(m)}>{fmtTime(m, true)}</button>
                <button className="chip-x" onClick={() => updateMarkers(markers.filter((_, j) => j !== i))} aria-label="マーカーを削除">
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
