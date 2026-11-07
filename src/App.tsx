import { listen } from "@tauri-apps/api/event";
import { videoDir } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileList, type Tab } from "./components/FileList";
import { HelpOverlay } from "./components/HelpOverlay";
import { Jobs, type Job } from "./components/Jobs";
import { Player, type ExportRequest } from "./components/Player";
import { checkFfmpeg, SettingsDialog } from "./components/SettingsDialog";
import { api, errorText, type ClipProgress, type FfmpegInfo, type VideoFile } from "./lib/api";
import { fmtClock, joinPath, recordingLabel, stripExt } from "./lib/format";
import { useSettings } from "./lib/settings";
import { useFolderWatch } from "./lib/useFolderWatch";

type Current = { file: VideoFile; autoPlay: boolean; auto?: boolean };
type Toast = { id: number; text: string; action?: { label: string; run: () => void } };

let seq = 1;

export default function App() {
  const [settings, updateSettings] = useSettings();
  const [tab, setTab] = useState<Tab>("rec");
  const [current, setCurrent] = useState<Current | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [ffmpeg, setFfmpeg] = useState<FfmpegInfo | null>(null);
  const [ffmpegError, setFfmpegError] = useState<string | null>(null);

  const clipDir = settings.clipDir ?? (settings.folder ? joinPath(settings.folder, "clips") : null);

  const toast = useCallback((text: string, action?: Toast["action"]) => {
    const id = seq++;
    setToasts((t) => [...t.slice(-2), { id, text, action }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 8000 : 4000);
  }, []);

  const openFile = useCallback((file: VideoFile, autoPlay = true) => {
    setCurrent({ file, autoPlay });
  }, []);

  // ---- フォルダ監視 ----

  const rec = useFolderWatch(settings.folder, {
    onInitial: (ready) => {
      // 起動したら最新の録画を開いておく（再生はしない）
      if (settings.autoOpen && ready[0]) setCurrent((c) => c ?? { file: ready[0], autoPlay: false });
    },
    onNew: (fresh) => {
      const f = fresh[0];
      const name = `${fmtClock(f.modified)} の${recordingLabel(f.name)}`;
      if (settings.autoOpen) {
        setCurrent({ file: f, autoPlay: settings.autoPlay, auto: true });
        setTab("rec");
        toast(`${name}を開きました`);
      } else {
        toast(`${name}ができました`, { label: "開く", run: () => openFile(f) });
      }
    },
  });
  const clips = useFolderWatch(clipDir);

  // 一覧で見えている情報（サイズなど）が更新されたら、開いているファイルの情報も差し替える
  useEffect(() => {
    if (!current) return;
    const latest = [...rec.files, ...clips.files].find((f) => f.path === current.file.path);
    if (latest && (latest.size !== current.file.size || latest.modified !== current.file.modified)) {
      setCurrent((c) => (c ? { ...c, file: latest } : c));
    }
  }, [rec.files, clips.files, current]);

  // ---- ffmpeg ----

  const recheckFfmpeg = useCallback(async (path: string) => {
    const { info, error } = await checkFfmpeg(path);
    setFfmpeg(info);
    setFfmpegError(error);
  }, []);

  useEffect(() => {
    recheckFfmpeg(settings.ffmpegPath);
    // 起動時に 1 回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 書き出し ----

  useEffect(() => {
    const un = listen<ClipProgress>("clip-progress", (e) => {
      setJobs((js) => js.map((j) => (j.id === e.payload.jobId && j.status === "running" ? { ...j, ratio: e.payload.ratio } : j)));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const startExport = async (req: ExportRequest) => {
    if (!current || !clipDir) return;
    const id = seq++;
    const label = req.name || stripExt(current.file.name);
    setJobs((js) => {
      // 終わったジョブは直近 3 件だけ残す
      const keep = new Set(js.filter((j) => j.status !== "running").slice(-3).map((j) => j.id));
      const rest = js.filter((j) => j.status === "running" || keep.has(j.id));
      return [...rest, { id, label, mode: req.mode, ratio: 0, status: "running" }];
    });
    try {
      const result = await api.exportClip({
        jobId: id,
        input: current.file.path,
        start: req.start,
        end: req.end,
        mode: req.mode,
        outputDir: clipDir,
        name: req.name || undefined,
        ffmpegPath: settings.ffmpegPath || undefined,
        targetMb: settings.discordMb,
      });
      setJobs((js) => js.map((j) => (j.id === id ? { ...j, status: "done", ratio: 1, result } : j)));
      clips.refresh();
    } catch (e) {
      setJobs((js) => js.map((j) => (j.id === id ? { ...j, status: "error", error: errorText(e) } : j)));
    }
  };

  // ---- いろいろな操作 ----

  const pickFolder = async () => {
    const defaultPath = settings.folder ?? (await videoDir().catch(() => undefined));
    const dir = await open({ directory: true, defaultPath, title: "OBS の録画フォルダを選ぶ" });
    if (typeof dir === "string") {
      updateSettings({ folder: dir });
      setCurrent(null);
      setTab("rec");
    }
  };

  const reveal = (path: string) => revealItemInDir(path).catch((e) => toast(errorText(e)));

  const copyFile = async (path: string) => {
    try {
      await api.copyFileToClipboard(path);
      toast("コピーしました。Discord のメッセージ欄で Ctrl+V すると貼れます");
    } catch (e) {
      toast(errorText(e));
    }
  };

  const toggleFullscreen = useCallback(async () => {
    const next = !fullscreen;
    setFullscreen(next);
    try {
      await getCurrentWindow().setFullscreen(next);
    } catch {
      /* ウィンドウ操作が使えなくてもプレイヤー部分の拡大はできる */
    }
  }, [fullscreen]);

  // ドラッグ＆ドロップ: 動画ならそのまま開く、フォルダなら録画フォルダにする
  const dropRef = useRef<(paths: string[]) => void>(() => {});
  dropRef.current = async (paths: string[]) => {
    const p = paths[0];
    if (!p) return;
    try {
      openFile(await api.openExternalFile(p));
    } catch (e) {
      try {
        await api.listVideos(p);
        updateSettings({ folder: p });
        setCurrent(null);
        setTab("rec");
        toast("録画フォルダを変更しました");
      } catch {
        toast(errorText(e));
      }
    }
  };
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "enter" || e.payload.type === "over") setDropping(true);
      else if (e.payload.type === "leave") setDropping(false);
      else if (e.payload.type === "drop") {
        setDropping(false);
        dropRef.current(e.payload.paths);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const currentPath = current?.file.path ?? null;
  const isClip = !!(current && clips.files.some((f) => f.path === current.file.path));

  return (
    <div className={`app ${fullscreen ? "is-fullscreen" : ""}`}>
      {!fullscreen && (
        <FileList
          tab={tab}
          onTab={setTab}
          folder={settings.folder}
          recordings={rec.files}
          clips={clips.files}
          writing={rec.writing}
          currentPath={currentPath}
          loaded={tab === "rec" ? rec.loaded : clips.loaded}
          error={tab === "rec" ? rec.error : clips.error}
          ffmpegMissing={!ffmpeg && !!ffmpegError}
          onPickFolder={pickFolder}
          onOpen={(f) => openFile(f)}
          onOpenSettings={() => setShowSettings(true)}
          onShowHelp={() => setShowHelp(true)}
        />
      )}

      <Player
        file={current?.file ?? null}
        autoPlay={current?.autoPlay ?? false}
        autoOpened={current?.auto ?? false}
        writing={!!currentPath && rec.writing.has(currentPath)}
        isClip={isClip}
        settings={settings}
        updateSettings={updateSettings}
        keyboardEnabled={!showSettings && !showHelp}
        fullscreen={fullscreen}
        onToggleFullscreen={toggleFullscreen}
        onExport={startExport}
        onReveal={reveal}
        onCopyFile={copyFile}
        onShowHelp={() => setShowHelp(true)}
        onNotice={toast}
      />

      <Jobs
        jobs={jobs}
        limitMb={settings.discordMb}
        onCancel={(id) => api.cancelClip(id)}
        onDismiss={(id) => setJobs((js) => js.filter((j) => j.id !== id))}
        onPlay={(path) => {
          const f = clips.files.find((x) => x.path === path);
          if (f) {
            openFile(f);
            setTab("clips");
          } else {
            api.openExternalFile(path).then((x) => openFile(x), (e) => toast(errorText(e)));
          }
        }}
        onReveal={reveal}
        onCopy={copyFile}
      />

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast panel">
            <span>{t.text}</span>
            {t.action && (
              <button
                className="link"
                onClick={() => {
                  t.action!.run();
                  setToasts((ts) => ts.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>

      {dropping && <div className="drop-overlay">ここに落とすと開きます（フォルダなら録画フォルダにします）</div>}

      {showSettings && (
        <SettingsDialog
          settings={settings}
          updateSettings={updateSettings}
          onPickFolder={pickFolder}
          onClose={() => setShowSettings(false)}
          ffmpeg={ffmpeg}
          ffmpegError={ffmpegError}
          onRecheckFfmpeg={recheckFfmpeg}
        />
      )}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
    </div>
  );
}
