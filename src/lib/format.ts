/** 秒 → "1:23" / "1:02:03"。tenths=true で "1:23.4" */
export function fmtTime(sec: number, tenths = false): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  // 表示上の繰り上がり（59.96 → "1:00.0"）を防ぐため先に丸める
  const t = tenths ? Math.floor(sec * 10) / 10 : Math.floor(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = tenths ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 長さ表示 "5.0秒" / "1分05秒" */
export function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}秒`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}分${String(s).padStart(2, "0")}秒`;
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

const WEEK = ["日", "月", "火", "水", "木", "金", "土"];

/** 一覧の見出し用: "今日" / "昨日" / "11月5日(水)" */
export function dayLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (diff === 0) return "今日";
  if (diff === 1) return "昨日";
  const base = `${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]})`;
  return d.getFullYear() === today.getFullYear() ? base : `${d.getFullYear()}年${base}`;
}

export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "3分前" のような相対表記（1時間以内のみ。それ以上は null） */
export function fmtAgo(ms: number, now = Date.now()): string | null {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "たった今";
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  return null;
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.replace(/[\\/]+$/, "") + sep + name;
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}
