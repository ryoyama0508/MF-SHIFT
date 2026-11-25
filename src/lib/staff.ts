import { COORD_RE, DEPT_LABELS, REG_COLUMNS } from "./constants";
import { cn, col, norm } from "./util";
import type { MasterRow, SheetData, StaffRule } from "./types";
import type { XlsxBook } from "./xlsx";

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    return row;
  });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function loadRegistry(text: string): StaffRule[] {
  const rows = parseCsv(text);
  if (!rows.length || !REG_COLUMNS.every((k) => k in rows[0])) {
    throw new Error("staff_registry.csvのヘッダーが不足");
  }
  return rows.map((r) => {
    const rule = {} as StaffRule;
    for (const k of REG_COLUMNS) rule[k] = (r[k] || "").trim();
    return rule;
  });
}

export function loadMaster(text: string): MasterRow[] {
  return parseCsv(text).map((r) => ({
    スタッフID: (r["スタッフID"] || "").trim(),
    スタッフ名: (r["スタッフ名"] || "").trim(),
    スタッフの区分け: (r["スタッフの区分け"] || "").trim(),
  }));
}

function blankRule(): StaffRule {
  const rule = {} as StaffRule;
  for (const k of REG_COLUMNS) rule[k] = "";
  return rule;
}

export function identifyStaff(
  book: XlsxBook,
  sh: SheetData,
  headerrow: number,
  reg: StaffRule[],
  master: MasterRow[],
): Array<[string, string, StaffRule, string]> {
  const names: Array<[string, string, string]> = [];
  let department = "";
  const cols = Object.keys(sh.cells)
    .map((addr) => {
      const m = COORD_RE.exec(addr);
      if (!m || Number(m[2]) !== headerrow) return null;
      const n = cn(m[1]);
      return n >= 3 ? n : null;
    })
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);

  for (const n of cols) {
    const c = col(n);
    department = book.get(sh, `${c}${headerrow - 1}`).value.trim() || department;
    const display = book.get(sh, `${c}${headerrow}`).value.trim();
    if (display && !/^\d+$/.test(display) && !DEPT_LABELS.has(display)) {
      names.push([c, display, department]);
    }
  }

  const assigned: Array<[string, string, StaffRule, string]> = [];
  const used = new Set<string>();
  const masterNames = Object.fromEntries(master.map((x) => [x.スタッフID, x.スタッフ名]));

  for (const [c, display, dept] of names) {
    const normalized = norm(display);
    let matches = reg.filter((r) => norm(r.Excel名) === normalized);
    if (matches.length > 1) {
      matches = matches.filter((r) => norm(r.部署) === norm(dept));
    }
    let rule: StaffRule;
    let matchStatus: string;
    if (matches.length === 1) {
      rule = { ...matches[0] };
      matchStatus = "登録済み対応表";
    } else {
      const role = master.filter((x) => {
        const n = norm(x.スタッフ名);
        // 末尾数字の別名（山田果林2 等）と【皮膚科】接頭辞は除外
        return (
          (n.startsWith(normalized) || n.includes(normalized)) &&
          !n.startsWith("【") &&
          !/\d$/.test(n)
        );
      });
      // Excel短縮名がフルネーム先頭と一致するものを優先
      const preferred = role.filter((x) => norm(x.スタッフ名).startsWith(normalized));
      const pool = preferred.length ? preferred : role;
      if (pool.length === 1) {
        const candidate = pool[0];
        rule = blankRule();
        Object.assign(rule, {
          Excel名: display,
          部署: dept,
          MF登録名: candidate.スタッフ名,
          スタッフID: candidate.スタッフID,
          ID確認: "確認済",
          対象: "1",
          空欄の扱い: "勤務",
        });
        matchStatus = "マスター自動照合";
      } else {
        rule = blankRule();
        Object.assign(rule, {
          Excel名: display,
          部署: dept,
          ID確認: "未照合",
          対象: "1",
          空欄の扱い: "勤務",
        });
        matchStatus = pool.length > 1 ? "ID候補が複数あります" : "ID候補なし";
      }
    }
    if (rule.スタッフID && norm(masterNames[rule.スタッフID] || "") !== norm(rule.MF登録名)) {
      matchStatus += " / マスターID氏名不一致";
      rule.ID確認 = "要確認";
    }
    if (rule.スタッフID && used.has(rule.スタッフID)) {
      matchStatus += " / 重複スタッフID";
      rule.ID確認 = "要確認";
    }
    used.add(rule.スタッフID);
    assigned.push([c, display, rule, matchStatus]);
  }
  return assigned;
}
