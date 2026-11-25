import { OFF_WORDS, RANGE_RE, WORK_WORDS } from "./constants";
import { norm } from "./util";
import type { AppConfig, CellData, DayStatus, StaffRule } from "./types";

export function timeNorm(s: unknown): string {
  const raw = String(s ?? "").normalize("NFKC").trim();
  if (!raw) return "";
  const m = /^(\d{1,2})(?:(:)(\d{1,2})|\.(\d+))?$/.exec(raw);
  if (!m) throw new Error(`時刻表記が未対応: ${JSON.stringify(s)}`);
  const h = Number(m[1]);
  let mi = Number(m[3] || 0);
  if (m[4]) {
    const frac = Number("0." + m[4]);
    mi = Math.round(frac * 60);
  }
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi < 60)) {
    throw new Error(`時刻が範囲外: ${JSON.stringify(s)}`);
  }
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

export function minutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function cleanTimeExpr(raw: string): string {
  let x = raw.normalize("NFKC").trim();
  for (const symbol of ["−", "ー", "‐", "‑", "–", "—", "ｰ", "~", "〜", "～", "－"]) {
    x = x.replaceAll(symbol, "-");
  }
  return x.replace(/\s+/g, "");
}

export function decodeTime(
  raw: string,
  rule: StaffRule,
  allowDecimal: boolean,
): [string, string, string, string] {
  const cleaned = cleanTimeExpr(raw);
  const pieces = cleaned.split("/");
  if (pieces.length > 2) throw new Error("休憩範囲が複数");
  const main = pieces[0];
  let start: string;
  let end: string;
  if (WORK_WORDS.has(main) || main === "WORK") {
    start = rule.通常出勤;
    end = rule.通常退勤;
  } else {
    const m = RANGE_RE.exec(main);
    if (m && (m[1] || m[2])) {
      if (main.includes(".") && !allowDecimal) throw new Error("17.5形式は確認設定が必要");
      start = m[1] || rule.通常出勤;
      end = m[2] || rule.通常退勤;
    } else if (/^\d{1,2}(?:\.\d+)?$/.test(main) && allowDecimal) {
      start = rule.通常出勤;
      end = main;
    } else {
      throw new Error(`勤務文字を解釈できません: ${JSON.stringify(raw)}`);
    }
  }
  start = timeNorm(start);
  end = timeNorm(end);
  if (!start || !end) throw new Error("出勤/退勤時刻が設定されていません");
  let bs = timeNorm(rule.休憩開始);
  let be = timeNorm(rule.休憩終了);
  if (pieces.length === 2) {
    const m = RANGE_RE.exec(pieces[1]);
    if (!m || !m[1] || !m[2]) throw new Error("休憩時間の形式が不正");
    bs = timeNorm(m[1]);
    be = timeNorm(m[2]);
  }
  if (Boolean(bs) !== Boolean(be)) throw new Error("休憩は開始・終了をセットで入力");
  if (minutes(start) >= minutes(end)) throw new Error("日跨ぎ勤務/終了以前の時刻は未対応");
  if (bs && !(minutes(start) <= minutes(bs) && minutes(bs) < minutes(be) && minutes(be) <= minutes(end))) {
    throw new Error("休憩が勤務時間外");
  }
  return [start, end, bs, be];
}

export type InterpretResult = [DayStatus, string, string[] | null];

export function interpret(
  cell: CellData,
  rule: StaffRule,
  cfg: AppConfig,
  fullcolblank = false,
): InterpretResult {
  const txt = cell.value.trim();
  const n = cleanTimeExpr(txt);
  const t = norm(txt);
  if (cell.formula && !txt) return ["要確認", "数式の値が保存されていません", null];
  if (fullcolblank) return ["要確認", "月全体に勤務・休みの区別がない列。対象スタッフか確認", null];

  const offNorm = new Set([...OFF_WORDS].map(norm));
  if (offNorm.has(t) || (t.startsWith("有") && /^\d+$/.test(t.slice(1))) || (t.startsWith("夏") && /^\d+$/.test(t.slice(1)))) {
    return ["非勤務", "休暇・希望休などの表示", null];
  }

  const isTime = Boolean(RANGE_RE.exec(n)) || Boolean(/^\d{1,2}(?:\.\d+)?$/.exec(n));
  const workNorm = new Set([...WORK_WORDS].map(norm));
  if (isTime || (n.includes("/") && RANGE_RE.exec(n.split("/")[0])) || workNorm.has(t)) {
    try {
      return ["勤務", "時刻/勤務記号による指定", decodeTime(txt, rule, cfg.decimal_hours_verified)];
    } catch (ex) {
      return ["要確認", ex instanceof Error ? ex.message : String(ex), null];
    }
  }

  if (txt) {
    const codeRules = cfg.text_codes ?? {};
    if (txt in codeRules) {
      const value = codeRules[txt];
      if (value === "off") return ["非勤務", "承認済み文字ルール", null];
      if (value === "work") {
        try {
          return ["勤務", "承認済み文字ルール", decodeTime("WORK", rule, cfg.decimal_hours_verified)];
        } catch (ex) {
          return ["要確認", ex instanceof Error ? ex.message : String(ex), null];
        }
      }
    }
    return ["要確認", `未定義の記号: ${JSON.stringify(txt)}`, null];
  }

  if (cell.gray) {
    if (cfg.gray_means_off_verified) return ["非勤務", "承認済み: 灰色は休み", null];
    return ["要確認", "灰色の意味が未承認", null];
  }

  if (cell.color) {
    const rgb: [number, number, number] = [
      parseInt(cell.color.slice(1, 3), 16),
      parseInt(cell.color.slice(3, 5), 16),
      parseInt(cell.color.slice(5, 7), 16),
    ];
    if (Math.min(...rgb) < 230) {
      return ["要確認", "灰色以外の背景色の意味が未定義: " + cell.color, null];
    }
  }

  const blank = rule.空欄の扱い;
  if (blank === "勤務") {
    try {
      return ["勤務", "承認済み: 白い空欄を勤務と解釈", decodeTime("WORK", rule, cfg.decimal_hours_verified)];
    } catch (ex) {
      return ["要確認", ex instanceof Error ? ex.message : String(ex), null];
    }
  }
  if (blank === "無視") return ["非勤務", "承認済み: 白い空欄は除外", null];
  return ["要確認", "白い空欄の意味が未設定", null];
}
