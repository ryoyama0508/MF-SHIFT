import { CLINIC_ID, COORD_RE } from "./constants";
import { fingerprintPayload, mfHeaderBase64 } from "./csv";
import { decodeTime, interpret } from "./interpret";
import { identifyStaff, loadMaster, loadRegistry } from "./staff";
import type { AppConfig, DrawingPending, ReviewPayload, StaffEditor, StaffRule } from "./types";
import { cn, col, formatDate, isoDate, monthDays, monthFor, parseDay } from "./util";
import { XlsxBook } from "./xlsx";

function locateLayout(book: XlsxBook, sh: ReturnType<XlsxBook["read"]>, ym: [number, number]) {
  const [y, m] = ym;
  const last = monthDays(y, m);
  const matches: number[] = [];
  for (let r = 1; r < 16; r++) {
    const days = [0, 1, 2].map((k) => parseDay(book.get(sh, `A${r + k}`).value));
    if (days[0] === 1 && days[1] === 2 && days[2] === 3) matches.push(r);
  }
  if (matches.length !== 1) {
    throw new Error(`${sh.name}: 日付開始行を特定できません ${JSON.stringify(matches)}`);
  }
  const first = matches[0];
  for (let d = 1; d <= last; d++) {
    const got = parseDay(book.get(sh, `A${first + d - 1}`).value);
    if (got !== d) {
      throw new Error(`${sh.name}: A${first + d - 1}の日付が不整合: ${got},期待${d}`);
    }
  }
  return { first, header: first - 1, last };
}

function withClinicDefaults(rule: StaffRule, config: AppConfig): StaffRule {
  const start = config.default_start || "10:00";
  const end = config.default_end || "19:00";
  const blank =
    config.blank_means_work !== false && (rule.空欄の扱い === "要確認" || !rule.空欄の扱い)
      ? "勤務"
      : rule.空欄の扱い || "勤務";
  return {
    ...rule,
    空欄の扱い: blank,
    通常出勤: rule.通常出勤 || start,
    通常退勤: rule.通常退勤 || end,
  };
}

export type ConvertInput = {
  buffer: Buffer | ArrayBuffer | Uint8Array;
  sheetName: string;
  config: AppConfig;
  registryCsv: string;
  masterCsv: string;
};

export async function convertToReview(input: ConvertInput): Promise<ReviewPayload> {
  const { config } = input;
  if (config.clinic_id !== CLINIC_ID) throw new Error("クリニックIDを変更しないでください");

  const xlsx = await XlsxBook.fromBuffer(input.buffer);
  let name = input.sheetName;
  if (!(name in xlsx.sheets)) {
    const fallback = Object.keys(xlsx.sheets).filter((n) => n.trim() === name.trim());
    if (fallback.length === 1) name = fallback[0];
  }
  if (!(name in xlsx.sheets)) throw new Error("指定シートが存在しません: " + name);

  const ym = monthFor(name);
  if (!ym) throw new Error("年月を識別できないシートです: " + name);

  const sh = xlsx.read(name);
  const titleMonth = monthFor(xlsx.get(sh, "A1").value);
  if (titleMonth && (titleMonth[0] !== ym[0] || titleMonth[1] !== ym[1])) {
    throw new Error(
      `シート名 ${name} の年月 ${ym} と表題A1の年月 ${titleMonth} が異なります。データの年月を確認してください。`,
    );
  }

  const { first, header, last } = locateLayout(xlsx, sh, ym);
  const reg = loadRegistry(input.registryCsv);
  const masterrows = loadMaster(input.masterCsv);
  const assigned = identifyStaff(xlsx, sh, header, reg, masterrows);
  if (!assigned.length) throw new Error("スタッフ列を検出できません。確認をお願いします。");

  const mergedOverlay = new Map<string, [string, string]>();
  const activeCols = new Set(assigned.map(([c]) => c));
  for (const region of sh.merged) {
    const parts = region.split(":");
    if (parts.length !== 2) continue;
    const a = COORD_RE.exec(parts[0]);
    const b = COORD_RE.exec(parts[1]);
    if (!a || !b) continue;
    const leftnum = cn(a[1]);
    const top = Number(a[2]);
    const rightnum = cn(b[1]);
    const bottom = Number(b[2]);
    if (bottom < first || top >= first + last) continue;
    const t = xlsx.get(sh, parts[0]).value.trim();
    if (!t) continue;
    for (let r = Math.max(first, top); r < Math.min(first + last, bottom + 1); r++) {
      for (let n = leftnum; n <= rightnum; n++) {
        const cc = col(n);
        if (activeCols.has(cc)) mergedOverlay.set(`${cc},${r}`, [region, t]);
      }
    }
  }

  const drawingDecisions = config.drawing_day_decisions ?? {};
  const wholeClinicClosed = new Set<number>();
  const drawings: DrawingPending[] = [];
  const seenDrawingDates = new Set<string>();
  for (const dr of sh.drawings) {
    const day = dr.行 - first + 1;
    if (!(day >= 1 && day <= last)) continue;
    const date = isoDate(ym[0], ym[1], day);
    const action = (drawingDecisions[date] ?? "") as DrawingPending["decision"];
    if (action === "off") wholeClinicClosed.add(day);
    if (!seenDrawingDates.has(date)) {
      seenDrawingDates.add(date);
      drawings.push({ date, text: dr.文字, decision: action });
    }
  }

  const warnings: string[] = [];
  if (sh.conditional.length) {
    warnings.push("条件付き書式があります。表示色とセル色が異なる可能性があります。");
  }

  const editorStaff: StaffEditor[] = [];

  for (const [c, display, rule0] of assigned) {
    const rule = withClinicDefaults(rule0, config);
    const sid = rule.スタッフID;
    const status = rule.ID確認;
    if (rule.対象 !== "1") continue;
    const days: StaffEditor["days"] = [];
    const colcells = Array.from({ length: last }, (_, i) => xlsx.get(sh, `${c}${first + i}`));
    const indicator = colcells.reduce((s, x) => s + (x.value.trim() || x.gray ? 1 : 0), 0);
    const sparse = indicator <= 1;
    const note = sparse ? "記入がほぼない列です。未使用なら「今月の対象外」にしてください。" : undefined;

    // IDがあれば初期選択に載せる（要確認でも候補を未設定にしない）
    const notes: string[] = [];
    if (note) notes.push(note);
    if (!sid) notes.push("メディフォに名前が登録されていなさそうです。対象外にするか、登録名を手選択してください。");
    else if (status !== "確認済") notes.push("対応表上は要確認ですが、候補IDを選択済みにしています。");

    editorStaff.push({
      name: display,
      column: c,
      id: sid,
      candidate: sid,
      days,
      note: notes.length ? notes.join(" ") : undefined,
    });

    for (let d = 1; d <= last; d++) {
      const cell = colcells[d - 1];
      const dat = formatDate(ym[0], ym[1], d);
      const addr = `${c}${first + d - 1}`;
      const merged = mergedOverlay.get(`${c},${first + d - 1}`);
      let outcome: "勤務" | "非勤務" | "要確認";
      let reason: string;
      let times: string[] | null;

      if (merged && !(merged[1] in (config.merged_cell_codes ?? {}))) {
        outcome = "要確認";
        reason = `結合セル ${merged[0]} の文字 ${JSON.stringify(merged[1])} は勤務/休日の判定未設定`;
        times = null;
      } else if (merged && config.merged_cell_codes[merged[1]] === "off") {
        outcome = "非勤務";
        reason = `承認済み結合セル ${JSON.stringify(merged[1])} は非勤務`;
        times = null;
      } else if (merged && config.merged_cell_codes[merged[1]] === "work") {
        try {
          times = decodeTime("WORK", rule, config.decimal_hours_verified);
          outcome = "勤務";
          reason = `承認済み結合セル ${JSON.stringify(merged[1])} は通常勤務`;
        } catch (e) {
          outcome = "要確認";
          reason = e instanceof Error ? e.message : String(e);
          times = null;
        }
      } else if (wholeClinicClosed.has(d)) {
        outcome = "非勤務";
        reason = "図形の休診日（全員休み）";
        times = null;
      } else {
        [outcome, reason, times] = interpret(cell, rule, config, false);
      }

      let proposed = times;
      if (!proposed && outcome !== "非勤務") {
        try {
          proposed = decodeTime(cell.value || "WORK", rule, true);
        } catch {
          proposed = null;
        }
      }
      // 白空欄＝勤務で時刻だけ足りない場合は既定時刻で勤務確定
      if (outcome === "要確認" && reason.includes("出勤/退勤時刻") && proposed) {
        outcome = "勤務";
        reason = "白い空欄を通常勤務（既定時刻）";
        times = proposed;
      }

      days.push({
        date: dat,
        addr,
        raw: cell.value,
        color: cell.color,
        status: outcome,
        reason,
        times: proposed,
      });
    }
  }

  const assumptions = [
    "白い空欄 → 出勤（既定 10:00–19:00）",
    "灰色の空欄 → 休み（非勤務・CSV行なし）",
    "明示的な時刻表記は色より優先",
  ];

  const payloadBody = {
    month: `${String(ym[0]).padStart(4, "0")}-${String(ym[1]).padStart(2, "0")}`,
    clinic: CLINIC_ID,
    staff: editorStaff,
    master: masterrows,
    header: mfHeaderBase64(),
    drawings,
    warnings,
    assumptions,
  };
  const json = JSON.stringify(payloadBody);
  return { ...payloadBody, fingerprint: fingerprintPayload(json) };
}

export function monthSheets(names: string[]): string[] {
  return names
    .filter((n) => monthFor(n))
    .sort((a, b) => {
      const ma = monthFor(a)!;
      const mb = monthFor(b)!;
      return mb[0] - ma[0] || mb[1] - ma[1];
    });
}
