import { MONTH_RE } from "./constants";

export function cn(c: string): number {
  let n = 0;
  for (const s of c) {
    if (s < "A" || s > "Z") throw new Error("不正な列: " + c);
    n = n * 26 + (s.charCodeAt(0) - 64);
  }
  return n;
}

export function col(n: number): string {
  let out = "";
  let x = n;
  while (x) {
    const r = (x - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

export function norm(v: unknown): string {
  return String(v ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/﨑/g, "崎")
    .replace(/兒/g, "児");
}

export function monthFor(sheetname: string): [number, number] | null {
  const match = MONTH_RE.exec(sheetname.trim());
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function monthDays(y: number, m: number): number {
  const begin = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
  return Math.round((end.getTime() - begin.getTime()) / 86400000);
}

export function parseDay(v: unknown): number | null {
  const m = /^\s*(\d{1,2})(?:\.0+)?(?:祝|[（(]祝[)）])?\s*$/.exec(String(v));
  if (!m) return null;
  const d = Number(m[1]);
  return d >= 1 && d <= 31 ? d : null;
}

export function formatDate(y: number, m: number, d: number): string {
  return `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
}

export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
