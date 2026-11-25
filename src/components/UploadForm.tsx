"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewPayload } from "@/lib/types";
import { saveReviewPayload } from "@/lib/session";

const dropIdle =
  "rounded-xl border-2 border-dashed px-6 py-14 text-center transition border-[#9fb3ac] bg-white hover:border-[#16594b]";
const dropActive =
  "rounded-xl border-2 border-dashed px-6 py-14 text-center transition border-[#16594b] bg-[#eaf2ef]";

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState("");

  const ingestFile = useCallback(async (f: File | null) => {
    setError("");
    setFile(null);
    setSheets([]);
    setSheet("");
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      setError("Excel（.xlsx）ファイルを選択してください");
      return;
    }
    setFile(f);
    setLoadingSheets(true);
    try {
      const body = new FormData();
      body.set("file", f);
      const res = await fetch("/api/sheets", { method: "POST", body });
      const data = (await res.json()) as { sheets?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error || "シート一覧の取得に失敗しました");
      const list = data.sheets ?? [];
      setSheets(list);
      setSheet(list[0] ?? "");
      if (!list.length) setError("月別シートが見つかりません");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSheets(false);
    }
  }, []);

  async function onConvert() {
    if (!file || !sheet) return;
    setConverting(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("sheet", sheet);
      const res = await fetch("/api/convert", { method: "POST", body });
      const data = (await res.json()) as ReviewPayload & { error?: string };
      if (!res.ok) throw new Error(data.error || "変換に失敗しました");
      saveReviewPayload(data);
      router.push("/review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void ingestFile(e.dataTransfer.files?.[0] ?? null);
        }}
        className={dragging ? dropActive : dropIdle}
      >
        <p className="text-lg font-medium text-[#173831]">シフト表 Excel をドロップ</p>
        <p className="mt-2 text-sm text-[#4d635c]">またはファイルを選択（.xlsx）</p>
        <label className="mt-5 inline-block cursor-pointer rounded-md bg-[#16594b] px-4 py-2 text-sm text-white">
          ファイルを選ぶ
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => void ingestFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {file && (
          <p className="mt-4 text-sm text-[#173831]">
            選択中: <strong>{file.name}</strong>（{(file.size / 1024).toFixed(0)} KB）
          </p>
        )}
      </div>

      <div className="rounded-xl border border-[#ccd9d5] bg-white p-5">
        <label className="block text-sm font-medium text-[#173831]">対象シート</label>
        <select
          className="mt-2 w-full max-w-md rounded-md border border-[#9fb3ac] bg-white px-3 py-2"
          value={sheet}
          disabled={!sheets.length || loadingSheets}
          onChange={(e) => setSheet(e.target.value)}
        >
          {!sheets.length && <option value="">{loadingSheets ? "読み込み中…" : "シートなし"}</option>}
          {sheets.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="mt-4 rounded-md bg-[#16594b] px-5 py-2.5 text-white disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!file || !sheet || converting || loadingSheets}
          onClick={() => void onConvert()}
        >
          {converting ? "変換中…" : "変換する"}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-[#e8c4bb] bg-[#fff5f2] px-4 py-3 text-[#91331e]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
