"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DayRecord, ReviewPayload, StaffEditor } from "@/lib/types";
import { loadReviewPayload } from "@/lib/session";

type PendingRow = {
  staff: StaffEditor;
  staffIndex: number;
  day: DayRecord;
  dayIndex: number;
};

function validTimes(t: string[] | null | undefined): boolean {
  if (!t || !t.slice(0, 2).every((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) || t[0]! >= t[1]!) return false;
  return (!t[2] && !t[3]) || Boolean(t[2] && t[3] && t[0]! <= t[2]! && t[2]! < t[3]! && t[3]! <= t[1]!);
}

/** システムが文字・記号の意味を判断できなかった行だけ */
function isUnknownMeaning(day: DayRecord): boolean {
  if (day.status !== "要確認") return false;
  return (
    day.reason.includes("未定義の記号") ||
    day.reason.includes("結合セル") ||
    day.reason.includes("背景色の意味が未定義") ||
    day.reason.includes("数式の値が保存されていません")
  );
}

function staffRowClass(s: StaffEditor, pending: number): string {
  const base = "border-b border-[#dee6e3] align-top";
  if (s.excluded) return `${base} bg-[#f3f4f3] opacity-70`;
  if (!s.id) return `${base} bg-[#fff4e8]`;
  if (pending > 0 || s.note) return `${base} bg-[#fff8e8]`;
  return base;
}

export function ReviewClient() {
  const router = useRouter();
  const [data, setData] = useState<ReviewPayload | null>(null);
  const [approved, setApproved] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    const payload = loadReviewPayload();
    if (!payload) {
      router.replace("/");
      return;
    }
    if (!payload.drawings) payload.drawings = [];
    if (!payload.warnings) payload.warnings = [];
    if (!payload.assumptions) {
      payload.assumptions = [
        "白い空欄 → 出勤（既定 10:00–19:00）",
        "灰色の空欄 → 休み（非勤務・CSV行なし）",
      ];
    }
    const key = `mf-shift-${payload.fingerprint}`;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null") as StaffEditor[] | null;
      if (saved && saved.length === payload.staff.length) {
        payload.staff = saved;
        setSavedMsg("前回の確認内容を復元しました。");
      }
    } catch {
      /* ignore */
    }
    setData(payload);
  }, [router]);

  function persist(next: ReviewPayload) {
    setData({ ...next, staff: next.staff.map((s) => ({ ...s, days: [...s.days] })) });
    try {
      localStorage.setItem(`mf-shift-${next.fingerprint}`, JSON.stringify(next.staff));
      setSavedMsg("確認内容をこのブラウザに保存しました。");
    } catch {
      setSavedMsg("このブラウザでは途中保存できません。CSVを保存してください。");
    }
  }

  const unknownRows: PendingRow[] = useMemo(() => {
    if (!data) return [];
    const rows: PendingRow[] = [];
    data.staff.forEach((staff, staffIndex) => {
      if (staff.excluded) return;
      staff.days.forEach((day, dayIndex) => {
        if (isUnknownMeaning(day)) rows.push({ staff, staffIndex, day, dayIndex });
      });
    });
    return rows;
  }, [data]);

  const summary = useMemo(() => {
    if (!data) return { text: "", canDownload: false, workCount: 0, exportCount: 0, skipped: 0 };
    const active = data.staff.filter((s) => !s.excluded);
    const workCount = active.reduce((n, s) => n + s.days.filter((d) => d.status === "勤務").length, 0);
    let exportCount = 0;
    let skipped = 0;
    for (const s of active) {
      for (const d of s.days) {
        if (d.status !== "勤務") {
          if (d.status === "要確認") skipped += 1;
          continue;
        }
        if (!s.id || !validTimes(d.times)) {
          skipped += 1;
          continue;
        }
        exportCount += 1;
      }
    }
    const missingIds = active.filter((s) => !s.id && s.days.some((d) => d.status === "勤務")).length;
    const unknown = unknownRows.length;
    const undrawn = (data.drawings || []).filter((d) => !d.decision).length;
    const text = `対象 ${active.length}人 ／ 出力予定 ${exportCount}件 ／ スキップ ${skipped}件 ／ 意味不明 ${unknown}件 ／ 図形未決 ${undrawn}件 ／ ID未設定 ${missingIds}人`;
    // わからない行・IDなしはスキップして出力可能（確認チェック＋1件以上あればOK）
    const canDownload = approved && exportCount > 0;
    return { text, canDownload, workCount, exportCount, skipped };
  }, [data, approved, unknownRows]);

  if (!data) return <p className="text-[#4d635c]">読み込み中…</p>;

  function resolveUnknown(r: PendingRow, mode: "work" | "off") {
    if (!data) return;
    const day = data.staff[r.staffIndex].days[r.dayIndex];
    if (mode === "off") {
      day.status = "非勤務";
      day.reason = "画面で非勤務に確定";
      day.times = null;
    } else {
      if (!validTimes(day.times)) {
        alert("候補時刻がないため勤務にできません。非勤務にするか、対象外にしてください。");
        return;
      }
      day.status = "勤務";
      day.reason = "画面で勤務に確定";
    }
    setApproved(false);
    persist(data);
  }

  function applyDrawing(date: string, decision: "off" | "note_only") {
    if (!data) return;
    const daySlash = `${date.slice(0, 4)}/${date.slice(5, 7)}/${date.slice(8, 10)}`;
    for (const staff of data.staff) {
      if (staff.excluded) continue;
      for (const day of staff.days) {
        if (day.date !== daySlash) continue;
        if (decision === "off") {
          day.status = "非勤務";
          day.reason = "図形: 全員休み";
          day.times = null;
        }
      }
    }
    data.drawings = data.drawings.map((d) => (d.date === date ? { ...d, decision } : d));
    setApproved(false);
    persist(data);
  }

  function downloadCsv() {
    if (!data) return;
    const lines: string[] = [];
    for (const s of data.staff.filter((x) => !x.excluded)) {
      for (const d of s.days) {
        if (d.status !== "勤務") continue;
        // IDなし・時刻不正・意味不明のままはスキップして続行
        if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(s.id) || !validTimes(d.times)) continue;
        lines.push([data.clinic, s.id, d.date, ...(d.times as string[])].join(","));
      }
    }
    if (!lines.length) {
      alert("出力できる勤務行がありません。");
      return;
    }
    const header = Uint8Array.from(atob(data.header), (c) => c.charCodeAt(0));
    const body = new TextEncoder().encode(lines.join("\r\n") + (lines.length ? "\r\n" : ""));
    const out = new Uint8Array(header.length + body.length);
    out.set(header, 0);
    out.set(body, header.length);
    const url = URL.createObjectURL(new Blob([out], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `medicalforce_${data.month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const missingIdStaff = data.staff.filter((s) => !s.excluded && !s.id && s.days.some((d) => d.status === "勤務"));

  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-[#ccd9d5] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-[#173831]">Ark Clinic　{data.month} 全員一括確認</h1>
          <Link href="/" className="text-sm text-[#16594b] underline">
            別ファイルを変換
          </Link>
        </div>
        <p className="mt-2 text-[#4d635c]" aria-live="polite">
          {summary.text}
        </p>
        {savedMsg && <p className="mt-1 text-xs text-[#6a7f78]">{savedMsg}</p>}
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[#4d635c]">
          {(data.assumptions || []).map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        {(data.warnings || []).map((w) => (
          <p key={w} className="mt-2 text-sm text-[#91331e]">
            {w}
          </p>
        ))}
      </header>

      <section className="rounded-xl border border-[#ccd9d5] bg-white p-5">
        <h2 className="text-lg font-medium text-[#173831]">1. 全スタッフ一覧（IDの確定）</h2>
        <p className="mt-1 text-sm text-[#4d635c]">
          全員分をまとめて確認します。薄いオレンジは要注目（ID未設定・注記・意味不明あり）。不要な列は「対象外」にしてください。
        </p>
        <div className="mt-3 overflow-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#dee6e3]">
                <th className="py-2 pr-2">Excel名</th>
                <th className="py-2 pr-2">列</th>
                <th className="py-2 pr-2">MF登録名</th>
                <th className="py-2 pr-2">勤務</th>
                <th className="py-2 pr-2">休み</th>
                <th className="py-2 pr-2">意味不明</th>
                <th className="py-2">対象外</th>
              </tr>
            </thead>
            <tbody>
              {data.staff.map((s) => {
                const work = s.days.filter((d) => d.status === "勤務").length;
                const off = s.days.filter((d) => d.status === "非勤務").length;
                const pending = s.days.filter((d) => isUnknownMeaning(d)).length;
                const notes = [
                  pending > 0 ? "意味不明なセルがあります。" : "",
                  s.note || "",
                ].filter(Boolean);
                return (
                  <tr key={s.column + s.name} className={staffRowClass(s, pending)}>
                    <td className="py-2 pr-2">
                      <div className="font-medium">{s.name}</div>
                      {notes.map((n) => (
                        <div key={n} className="mt-0.5 text-xs text-[#91331e]">
                          {n}
                        </div>
                      ))}
                    </td>
                    <td className="py-2 pr-2">{s.column}</td>
                    <td className="py-2 pr-2">
                      <select
                        className="max-w-[280px] rounded border border-[#9fb3ac] bg-white px-2 py-1"
                        value={s.id}
                        disabled={!!s.excluded}
                        onChange={(e) => {
                          s.id = e.target.value;
                          setApproved(false);
                          persist(data);
                        }}
                      >
                        <option value="">未設定</option>
                        {data.master.map((m) => (
                          <option key={m.スタッフID} value={m.スタッフID}>
                            {m.スタッフ名}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-2">{work}</td>
                    <td className="py-2 pr-2">{off}</td>
                    <td className="py-2 pr-2">{pending ? <span className="font-medium text-[#91331e]">{pending}</span> : 0}</td>
                    <td className="py-2">
                      <input
                        type="checkbox"
                        checked={!!s.excluded}
                        onChange={(e) => {
                          s.excluded = e.target.checked;
                          setApproved(false);
                          persist(data);
                        }}
                        aria-label={`${s.name}を対象外`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {missingIdStaff.length > 0 && (
          <p className="mt-3 text-sm text-[#91331e]">
            勤務があるのにID未設定: {missingIdStaff.map((s) => s.name).join("、")}
          </p>
        )}
      </section>

      {(data.drawings || []).length > 0 && (
        <section className="rounded-xl border border-[#ccd9d5] bg-white p-5">
          <h2 className="text-lg font-medium text-[#173831]">2. 図形メモ（全員共通）</h2>
          <p className="mt-1 text-sm text-[#4d635c]">休診日などの図形です。全員休みか、注記だけかを選んでください。</p>
          <ul className="mt-3 space-y-3">
            {data.drawings.map((dr) => (
              <li key={dr.date} className="flex flex-wrap items-center gap-3 rounded-md border border-[#dee6e3] bg-[#fff8e8] p-3">
                <span className="font-medium">
                  {dr.date}「{dr.text}」
                </span>
                <span className="text-sm text-[#4d635c]">
                  {dr.decision === "off" ? "→ 全員休み" : dr.decision === "note_only" ? "→ 注記のみ" : "→ 未決定"}
                </span>
                <button
                  type="button"
                  className="rounded border border-[#9fb3ac] bg-white px-3 py-1 text-sm"
                  onClick={() => applyDrawing(dr.date, "off")}
                >
                  全員休みにする
                </button>
                <button
                  type="button"
                  className="rounded border border-[#9fb3ac] bg-white px-3 py-1 text-sm"
                  onClick={() => applyDrawing(dr.date, "note_only")}
                >
                  注記のみ
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-[#ccd9d5] bg-white p-5">
        <h2 className="text-lg font-medium text-[#173831]">3. 意味がわからない文字・記号</h2>
        <p className="mt-1 text-sm text-[#4d635c]">
          白＝出勤・灰＝休みは自動適用済みです。「当直」「明」など意味がわからないマスです。未処理のままならCSV出力時にスキップされます。
        </p>
        {unknownRows.length === 0 ? (
          <p className="mt-4 text-sm text-[#16594b]">意味不明な記号はありません。</p>
        ) : (
          <div className="mt-4 max-h-[420px] overflow-auto">
            <table className="w-full min-w-[800px] border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-[#dee6e3]">
                  <th className="py-2 pr-2">スタッフ</th>
                  <th className="py-2 pr-2">日付</th>
                  <th className="py-2 pr-2">原本の文字</th>
                  <th className="py-2 pr-2">わからない理由</th>
                  <th className="py-2">このマスの扱い</th>
                </tr>
              </thead>
              <tbody>
                {unknownRows.map((r) => (
                  <tr key={`${r.staffIndex}:${r.dayIndex}`} className="border-b border-[#dee6e3] bg-[#fff8e8]">
                    <td className="py-2 pr-2">
                      {r.staff.name}（{r.staff.column}）
                    </td>
                    <td className="py-2 pr-2">{r.day.date}</td>
                    <td className="py-2 pr-2">
                      <span
                        className="mr-1 inline-block h-3.5 w-3.5 border border-[#aaa]"
                        style={{ background: r.day.color || "white" }}
                      />
                      {r.day.raw || "空欄"}
                    </td>
                    <td className="py-2 pr-2 text-[#91331e]">{r.day.reason}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded border border-[#9fb3ac] bg-white px-2 py-1 text-xs"
                          onClick={() => resolveUnknown(r, "work")}
                        >
                          勤務にする
                        </button>
                        <button
                          type="button"
                          className="rounded border border-[#9fb3ac] bg-white px-2 py-1 text-xs"
                          onClick={() => resolveUnknown(r, "off")}
                        >
                          非勤務にする
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="rounded-xl border border-[#ccd9d5] bg-white p-5">
        <h2 className="text-lg font-medium text-[#173831]">4. 全員分のCSVダウンロード</h2>
        <p className="mt-1 text-sm text-[#4d635c]">
          意味不明のマス・メディフォ未登録の人はスキップして出力します（CSVに含めません）。
        </p>
        <label className="mt-3 inline-flex items-center gap-2">
          <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
          内容を確認しました（わからない箇所はスキップして出力してよい）
        </label>
        <div className="mt-3">
          <button
            type="button"
            className="rounded-md bg-[#16594b] px-5 py-2.5 text-white disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!summary.canDownload}
            onClick={downloadCsv}
          >
            全員分の月次CSVをダウンロード（{summary.exportCount}件）
          </button>
        </div>
        {!approved && (
          <p className="mt-2 text-sm text-[#91331e]">上の確認チェックを入れるとダウンロードできます。</p>
        )}
      </footer>
    </div>
  );
}
