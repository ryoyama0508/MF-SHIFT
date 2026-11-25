import { readFileSync } from "fs";
import { convertToReview } from "../src/lib/convert";
import { loadAppConfig, loadMasterCsv, loadRegistryCsv } from "../src/lib/data";

async function main() {
  const sheet = process.argv[2] || "2026.12";
  const buf = readFileSync("./シフト表原本.xlsx");
  const payload = await convertToReview({
    buffer: buf,
    sheetName: sheet,
    config: loadAppConfig(),
    registryCsv: loadRegistryCsv(),
    masterCsv: loadMasterCsv(),
  });
  const pending = payload.staff.reduce(
    (n, s) => n + s.days.filter((d) => d.status === "要確認").length,
    0,
  );
  const map = payload.staff.map((s) => {
    const m = payload.master.find((x) => x.スタッフID === s.id);
    return `${s.name}→${m?.スタッフ名 || "未設定"}`;
  });
  console.log(
    JSON.stringify(
      {
        month: payload.month,
        staff: payload.staff.length,
        pending,
        unset: payload.staff.filter((s) => !s.id).map((s) => s.name),
        map,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
