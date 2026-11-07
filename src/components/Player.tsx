import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileSrc, type ClipMode, type VideoFile } from "../lib/api";
import { fmtClock, fmtDuration, fmtSize, fmtTime, rateLabel, recordingLabel, stripExt } from "../lib/format";
import { loadMarkers, saveMarkers, type Settings } from "../lib/settings";
import { Digits } from "./Digits";
import { Timeline } from "./Timeline";

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
/** ボタンで選べる速度。それ以外は [ ] キーで */
const SPEED_BUTTONS: [number, string][] = [
  [0.5, "ゆっくり"],
  [1, "ふつう"],
  [2, "2倍"],
  [4, "4倍"],
];
const QUICK_CLIP_SEC = 15;

export type ExportRequest = { start: number; end: number; mode: ClipMode; name: string };

type Props = {
  file: VideoFile | null;
  autoPlay: boolean;
  /** 新しい録画として自動で開いたか */
  autoOpened: boolean;
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
  if (writing) return "OBS がまだ書き込み中なので再生できません。録画を止めるか分割すると見られます（R で読み直し）。";
  switch (err?.code) {
    case MediaError.MEDIA_ERR_DECODE:
      return "映像をデコードできませんでした。HEVC や AV1 で録画していると、PC によっては再生できません。";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "この形式は再生できません。録画中のファイルか、対応していない形式かもしれません（mkv は OBS の「録画の再多重化」で mp4 にできます）。";
    default:
      return "動画を読み込めませんでした。";
  }
}

function PlayGlyph({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="2" width="4" height="12" rx="1.5" fill="currentColor" />
      <rect x="9" y="2" width="4" height="12" rx="1.5" fill="currentColor" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.6c0-.8.9-1.3 1.6-.9l8 5.4c.6.4.6 1.4 0 1.8l-8 5.4c-.7.4-1.6-.1-1.6-.9z" fill="currentColor" />
    </svg>
  );
}

export function Player(props: Props) {
  const { file, settings, writing } = props;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState(false);
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

  // ファイルが変わったら範囲・しるしなどをリセット
  useEffect(() => {
    setInPoint(null);
    setOutPoint(null);
    setClipName("");
    setError(null);
    setErrorDetail(null);
    setCurrent(0);
    setDuration(0);
    setLoaded(false);
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

  // 1 コマの長さを実測（30fps / 60fps どちらの録画でもコマ送りが 1 コマになるように）
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

  const seekBy = useCallback(
    (d: number) => {
      const v = videoRef.current;
      if (!v) return;
      seekTo(v.currentTime + d);
    },
    [seekTo],
  );

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
    flash(rateLabel(r));
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
    flash(`ここから ${fmtTime(t, true)}`);
  };
  const markOut = (t = now()) => {
    setOutPoint(t);
    if (inPoint != null && inPoint >= t) setInPoint(null);
    flash(`ここまで ${fmtTime(t, true)}`);
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
    const next = [...markers, t].sort((a, b) => a - b);
    updateMarkers(next);
    flash(`しるし ${next.indexOf(t) + 1}`);
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
      props.onNotice("I（ここから）と O（ここまで）で切り抜く範囲を決めてください");
      return;
    }
    props.onExport({ start: range.start, end: range.end, mode: settings.clipMode, name: clipName.trim() });
  };

  const reload = () => {
    resumeAt.current = now();
    autoPlayRef.current = !videoRef.current?.paused;
    setError(null);
    setErrorDetail(null);
    setLoaded(false);
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
    setLoaded(true);
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
      <main className="player">
        <div className="stage stage-empty">
          <p className="stage-title">見たい録画を左から選んでください</p>
          <p className="dim">動画ファイルやフォルダをウィンドウにドラッグしても開けます。</p>
          <button className="btn" onClick={props.onShowHelp}>
            キー操作の一覧 <kbd>?</kbd>
          </button>
        </div>
      </main>
    );
  }

  const title = props.isClip ? stripExt(file.name) : `${fmtClock(file.modified)} の${recordingLabel(file.name)}`;
  const meta = [props.autoOpened ? "自動で開きました" : null, duration > 0 ? fmtTime(duration) : null, fmtSize(file.size)]
    .filter(Boolean)
    .join(" ・ ");
  const skip = settings.skipSec;
  const modes: [ClipMode, string, string][] = [
    ["fast", "そのまま", "作り直さずに一瞬で切り抜きます。始まりが少し前にずれることがあります"],
    ["quality", "きれいに", "作り直してコマ単位で正確に切り抜きます"],
    ["discord", "Discord用", `${settings.discordMb}MB 以下に収まるよう小さくします`],
  ];

  return (
    <main className={`player ${props.fullscreen ? "fullscreen" : ""}`}>
      {!props.fullscreen && (
        <header className="player-head">
          <h1 title={file.path}>{title}</h1>
          <span className="dim">{meta}</span>
          <div className="head-actions">
            {props.isClip && (
              <button className="btn small" onClick={() => props.onCopyFile(file.path)} title="ファイルとしてコピーします。Discord で Ctrl+V すると貼れます">
                コピーして Discord へ
              </button>
            )}
            <button className="btn small" onClick={() => props.onReveal(file.path)}>
              フォルダで表示
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
        {!loaded && !error && <p className="stage-note">読み込み中…</p>}
        {error && (
          <div className="stage-error" role="alert">
            <p>{error}</p>
            {errorDetail && <small className="error-detail">{errorDetail}</small>}
            <button className="btn" onClick={reload}>
              読み直す <kbd>R</kbd>
            </button>
          </div>
        )}
        {!error && writing && (
          <div className="stage-banner">
            <span className="rec-dot" aria-hidden="true" />
            OBS がまだ書き込み中のファイルです
            <button className="link" onClick={reload}>
              読み直す（R）
            </button>
          </div>
        )}
        {osd && (
          <div className="osd" key={osd.key} aria-hidden="true">
            {osd.text}
          </div>
        )}
      </div>

      <section className="panel controls" aria-label="再生と切り抜き">
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

        <div className="row">
          <span className="tc timecode">
            <Digits text={fmtTime(current, true)} /> <span className="dim">/ {fmtTime(duration)}</span>
          </span>
          <div className="group">
            <button className="btn square" onClick={() => seekBy(-skip)} aria-label={`${skip}秒戻る`} title={`${skip}秒戻る（←）`}>
              -{skip}
            </button>
            <button className="btn square play" onClick={togglePlay} aria-label={playing ? "一時停止" : "再生"} title="再生 / 一時停止（Space）">
              <PlayGlyph playing={playing} />
            </button>
            <button className="btn square" onClick={() => seekBy(skip)} aria-label={`${skip}秒進む`} title={`${skip}秒進む（→）`}>
              +{skip}
            </button>
            <button className="btn" onClick={() => stepFrame(-1)} title="1コマ戻す（,）">
              コマ戻し
            </button>
            <button className="btn" onClick={() => stepFrame(1)} title="1コマ送る（.）">
              コマ送り
            </button>
          </div>

          <div className="group push">
            <div className="seg" role="radiogroup" aria-label="再生速度（[ ] でも変えられます）">
              {SPEED_BUTTONS.map(([r, label]) => (
                <button key={r} role="radio" aria-checked={rate === r} className={rate === r ? "on" : ""} onClick={() => applyRate(r)}>
                  {label}
                </button>
              ))}
              {!SPEED_BUTTONS.some(([r]) => r === rate) && <span className="seg-extra">{rateLabel(rate)}</span>}
            </div>
            <label className="volume">
              <span className="dim">音量</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={settings.muted ? 0 : settings.volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </label>
            <button className="btn" aria-pressed={settings.muted} onClick={() => props.updateSettings({ muted: !settings.muted })} title="ミュート（M）">
              {settings.muted ? "音を戻す" : "ミュート"}
            </button>
            <button className="btn" onClick={props.onToggleFullscreen} title="全画面（F）">
              {props.fullscreen ? "全画面をやめる" : "全画面"}
            </button>
          </div>
        </div>

        <div className="row clip-row">
          <button className="btn range-btn" onClick={() => markIn()} title="今の位置を始まりにします（I）。Shift+I でそこへ移動">
            <b>ここから</b>
            <span className="tc">{inPoint != null ? fmtTime(inPoint, true) : "--:--"}</span>
            <kbd>I</kbd>
          </button>
          <button className="btn range-btn" onClick={() => markOut()} title="今の位置を終わりにします（O）。Shift+O でそこへ移動">
            <b>ここまで</b>
            <span className="tc">{outPoint != null ? fmtTime(outPoint, true) : "--:--"}</span>
            <kbd>O</kbd>
          </button>
          <span className="range-len">{range ? `${fmtDuration(rangeLen)}ぶん` : <span className="dim">範囲はまだありません</span>}</span>
          <button className="btn" onClick={quickClip}>
            直前{QUICK_CLIP_SEC}秒 <kbd>Q</kbd>
          </button>
          {range && (
            <button className="btn" onClick={clearRange}>
              範囲を消す <kbd>X</kbd>
            </button>
          )}

          <div className="group push">
            <div className="seg" role="radiogroup" aria-label="切り抜き方">
              {modes.map(([mode, label, desc]) => (
                <button
                  key={mode}
                  role="radio"
                  aria-checked={settings.clipMode === mode}
                  className={settings.clipMode === mode ? "on" : ""}
                  onClick={() => props.updateSettings({ clipMode: mode })}
                  title={desc}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="name-field">
              <span className="dim">名前</span>
              <input
                placeholder="なくてもOK"
                value={clipName}
                onChange={(e) => setClipName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doExport();
                  if (e.key === "Escape") (e.target as HTMLInputElement).blur();
                }}
              />
            </label>
            <button className="btn primary" onClick={doExport} disabled={!range} title="切り抜く（E）">
              切り抜く <kbd>E</kbd>
            </button>
          </div>
        </div>

        <div className="row marks">
          <span className="marks-label">しるし</span>
          {markers.length === 0 ? (
            <span className="dim">気になったら B で付けておけます</span>
          ) : (
            <>
              {markers.map((m, i) => (
                <span key={`${m}-${i}`} className="mark-chip">
                  <button onClick={() => seekTo(m)} aria-label={`しるし${i + 1}（${fmtTime(m, true)}）へ移動`}>
                    <span className="mark-no">{i + 1}</span>
                    <span className="tc">{fmtTime(m, true)}</span>
                  </button>
                  <button className="mark-x" onClick={() => updateMarkers(markers.filter((_, j) => j !== i))} aria-label={`しるし${i + 1}を消す`}>
                    ×
                  </button>
                </span>
              ))}
              <span className="dim">N で次のしるしへ</span>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
