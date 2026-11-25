export const MF_COLUMNS = [
  "クリニックID ※必須",
  "スタッフID ※必須",
  "日付 ※必須",
  "出勤時間 ※必須",
  "退勤時間 ※必須",
  "休憩開始時間",
  "休憩終了時間",
] as const;

export const CLINIC_ID = "3e58a4188faa47469738bc31d4fd2537";

export const REG_COLUMNS = [
  "部署",
  "Excel名",
  "MF登録名",
  "スタッフID",
  "ID確認",
  "対象",
  "空欄の扱い",
  "通常出勤",
  "通常退勤",
  "休憩開始",
  "休憩終了",
  "備考",
] as const;

export const OFF_WORDS = new Set([
  "休",
  "休み",
  "有",
  "有休",
  "有給",
  "公休",
  "欠勤",
  "代休",
  "非番",
  "休日",
  "休診",
  "休診日",
  "希",
  "希望休",
  "希望",
  "冬休み",
  "夏休み",
  "夏",
  "冬",
  "夏１",
  "夏２",
  "冬１",
  "冬２",
  "(休)",
  "（休）",
  "育休",
  "振休",
  "特休",
]);

export const WORK_WORDS = new Set(["出", "出勤", "勤務", "○", "〇", "◯", "●"]);

export const DEPT_LABELS = new Set([
  "日",
  "曜日",
  "Ns",
  "Cs",
  "外科",
  "AGA",
  "広報",
  "事務",
  "皮膚科",
  "経理",
]);

export const MONTH_RE = /(?<!\d)(20\d{2})\s*[.．年/-]\s*(1[0-2]|0?[1-9])(?:\s*月)?/;
export const COORD_RE = /^([A-Z]+)(\d+)$/;
export const RANGE_RE = /^(\d{1,2}(?:[:.]\d{1,2})?)?-(\d{1,2}(?:[:.]\d{1,2})?)?$/;
