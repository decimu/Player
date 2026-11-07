import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, type VideoFile } from "./api";

/** 最終更新からこの時間以内なら「まだ書き込み中」とみなす */
const WRITING_GRACE_MS = 2500;
const POLL_MS = 1500;

type Options = {
  /** 初回の一覧取得が終わったとき（書き込み中でないファイルのみ、新しい順） */
  onInitial?: (ready: VideoFile[]) => void;
  /** 監視中に新しいファイルが書き終わったとき（新しい順） */
  onNew?: (fresh: VideoFile[]) => void;
};

function sameList(a: VideoFile[], b: VideoFile[]) {
  return (
    a.length === b.length &&
    a.every((f, i) => f.path === b[i].path && f.size === b[i].size && f.modified === b[i].modified)
  );
}

function sameSet(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/**
 * フォルダを定期的に見て、動画の一覧と「書き込み中（OBS が録画中）」のファイルを返す。
 * OBS の mp4 は録画が終わるまで再生できないので、サイズが止まってから「新しい録画」として通知する。
 */
export function useFolderWatch(dir: string | null, opts: Options = {}) {
  const [files, setFiles] = useState<VideoFile[]>([]);
  const [writing, setWriting] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  /** 最初の一覧取得が終わったか（読み込み中の表示に使う） */
  const [loaded, setLoaded] = useState(false);

  const optsRef = useRef(opts);
  optsRef.current = opts;
  const prevSizes = useRef(new Map<string, number>());
  const announced = useRef<Set<string> | null>(null);
  const inFlight = useRef(false);
  const dirRef = useRef(dir);
  dirRef.current = dir;

  const refresh = useCallback(async () => {
    const target = dirRef.current;
    if (!target || inFlight.current) return;
    inFlight.current = true;
    try {
      const list = await api.listVideos(target);
      if (dirRef.current !== target) return; // 途中でフォルダが変わった
      const now = Date.now();
      const nowWriting = new Set<string>();
      for (const f of list) {
        const prev = prevSizes.current.get(f.path);
        if ((prev !== undefined && prev !== f.size) || now - f.modified < WRITING_GRACE_MS) {
          nowWriting.add(f.path);
        }
      }
      prevSizes.current = new Map(list.map((f) => [f.path, f.size]));
      const ready = list.filter((f) => !nowWriting.has(f.path));

      if (announced.current === null) {
        announced.current = new Set(ready.map((f) => f.path));
        optsRef.current.onInitial?.(ready);
      } else {
        const known = announced.current;
        const fresh = ready.filter((f) => !known.has(f.path));
        fresh.forEach((f) => known.add(f.path));
        if (fresh.length) optsRef.current.onNew?.(fresh);
      }

      setFiles((prev) => (sameList(prev, list) ? prev : list));
      setWriting((prev) => (sameSet(prev, nowWriting) ? prev : nowWriting));
      setError(null);
      setLoaded(true);
    } catch (e) {
      setError(errorText(e));
      setLoaded(true);
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    prevSizes.current = new Map();
    announced.current = null;
    setFiles([]);
    setWriting(new Set());
    setError(null);
    setLoaded(false);
    if (!dir) return;

    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    // ゲームから Alt+Tab で戻ってきた瞬間に最新を拾う
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [dir, refresh]);

  return { files, writing, error, loaded, refresh };
}
