export type Rgb = [number, number, number];

export type CellData = {
  value: string;
  color: string;
  gray: boolean;
  exists: boolean;
  formula: boolean;
  fillId: number;
};

export type Drawing = {
  文字: string;
  行: number;
  列: string;
  日付?: string;
};

export type SheetData = {
  name: string;
  cells: Record<string, CellData>;
  merged: string[];
  conditional: string[];
  drawings: Drawing[];
};

export type StaffRule = {
  部署: string;
  Excel名: string;
  MF登録名: string;
  スタッフID: string;
  ID確認: string;
  対象: string;
  空欄の扱い: string;
  通常出勤: string;
  通常退勤: string;
  休憩開始: string;
  休憩終了: string;
  備考: string;
};

export type MasterRow = {
  スタッフID: string;
  スタッフ名: string;
  スタッフの区分け: string;
};

export type AppConfig = {
  clinic_id: string;
  sheet_name: string | null;
  gray_means_off_verified: boolean;
  decimal_hours_verified: boolean;
  work_rules_verified: boolean;
  blank_means_work?: boolean;
  default_start?: string;
  default_end?: string;
  text_codes: Record<string, "work" | "off">;
  drawing_day_decisions: Record<string, "off" | "note_only">;
  merged_cell_codes: Record<string, "work" | "off">;
};

export type DayStatus = "勤務" | "非勤務" | "要確認";

export type DayRecord = {
  date: string;
  addr: string;
  raw: string;
  color: string;
  status: DayStatus;
  reason: string;
  times: string[] | null;
};

export type StaffEditor = {
  name: string;
  column: string;
  id: string;
  candidate: string;
  days: DayRecord[];
  excluded?: boolean;
  note?: string;
};

export type DrawingPending = {
  date: string;
  text: string;
  decision: "" | "off" | "note_only";
};

export type ReviewPayload = {
  month: string;
  clinic: string;
  staff: StaffEditor[];
  master: MasterRow[];
  header: string;
  fingerprint: string;
  drawings: DrawingPending[];
  warnings: string[];
  assumptions: string[];
};
