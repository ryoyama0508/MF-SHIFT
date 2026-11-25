import { NextResponse } from "next/server";
import { convertToReview } from "@/lib/convert";
import { loadAppConfig, loadMasterCsv, loadRegistryCsv } from "@/lib/data";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const sheet = String(form.get("sheet") ?? "").trim();
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Excelファイルを選択してください" }, { status: 400 });
    }
    if (!sheet) {
      return NextResponse.json({ error: "シート名を指定してください" }, { status: 400 });
    }
    if (file.size > 4 * 1024 * 1024) {
      return NextResponse.json({ error: "ファイルが大きすぎます（4MBまで）" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const payload = await convertToReview({
      buffer,
      sheetName: sheet,
      config: loadAppConfig(),
      registryCsv: loadRegistryCsv(),
      masterCsv: loadMasterCsv(),
    });
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
