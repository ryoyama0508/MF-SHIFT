import { describe, expect, it } from "vitest";
import { decodeTime, interpret } from "./interpret";
import { monthFor, norm } from "./util";
import type { AppConfig, CellData, StaffRule } from "./types";

const rule: StaffRule = {
  部署: "",
  Excel名: "",
  MF登録名: "",
  スタッフID: "",
  ID確認: "",
  対象: "1",
  空欄の扱い: "勤務",
  通常出勤: "10:00",
  通常退勤: "19:00",
  休憩開始: "12:30",
  休憩終了: "13:30",
  備考: "",
};

const cfg: AppConfig = {
  clinic_id: "3e58a4188faa47469738bc31d4fd2537",
  sheet_name: null,
  gray_means_off_verified: true,
  decimal_hours_verified: true,
  work_rules_verified: true,
  blank_means_work: true,
  default_start: "10:00",
  default_end: "19:00",
  text_codes: {},
  drawing_day_decisions: {},
  merged_cell_codes: {},
};

describe("decodeTime", () => {
  it("parses -18 with defaults", () => {
    expect(decodeTime("-18", rule, true)).toEqual(["10:00", "18:00", "12:30", "13:30"]);
  });
  it("parses ranges", () => {
    const short = { ...rule, 休憩開始: "", 休憩終了: "" };
    expect(decodeTime("9-13", short, true).slice(0, 2)).toEqual(["09:00", "13:00"]);
    expect(decodeTime("11-19", rule, true).slice(0, 2)).toEqual(["11:00", "19:00"]);
  });
  it("parses fullwidth and decimals", () => {
    expect(decodeTime("ｰ１７", rule, true)[1]).toBe("17:00");
    expect(decodeTime("-17.5", rule, true)[1]).toBe("17:30");
  });
});

describe("interpret priority", () => {
  it("treats 希 as off", () => {
    const off: CellData = { value: "希", color: "#808080", gray: true, exists: true, formula: false, fillId: 1 };
    expect(interpret(off, rule, cfg)[0]).toBe("非勤務");
  });
  it("lets explicit time win over gray", () => {
    const worked: CellData = { value: "-18", color: "#808080", gray: true, exists: true, formula: false, fillId: 1 };
    expect(interpret(worked, rule, cfg)[0]).toBe("勤務");
  });
  it("flags unknown codes", () => {
    const unknown: CellData = { value: "学会", color: "#FFFFFF", gray: false, exists: true, formula: false, fillId: 0 };
    expect(interpret(unknown, rule, cfg)[0]).toBe("要確認");
  });
});

describe("monthFor / norm", () => {
  it("parses sheet months", () => {
    expect(monthFor("2026.8 ")).toEqual([2026, 8]);
    expect(monthFor("2026.11")).toEqual([2026, 11]);
  });
  it("normalizes names", () => {
    expect(norm("宮﨑")).toBe(norm("宮崎"));
  });
});
