import { NextResponse } from "next/server";
import { monthSheets } from "@/lib/convert";
import { listSheetNames } from "@/lib/xlsx";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Excelファイルを選択してください" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const names = await listSheetNames(buffer);
    return NextResponse.json({ sheets: monthSheets(names), all: names });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
