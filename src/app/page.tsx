import Image from "next/image";
import { UploadForm } from "@/components/UploadForm";

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <header className="mb-8 text-center">
        <div className="flex justify-center">
          <Image
            src="/clinic_logo.png"
            alt="Ark Cosmetic Surgery"
            width={220}
            height={158}
            priority
            className="h-auto w-[180px] sm:w-[220px]"
          />
        </div>
        <h1 className="mt-6 text-3xl font-semibold text-[#173831]">メディカルフォースシフト変換ツール</h1>
        <p className="mt-2 text-[#4d635c]">
          クリニックのシフトExcelをアップロードし、全スタッフまとめて Medical Force 用CSVに変換します。白い空欄は出勤、灰色は休みとして自動判定し、残った要確認だけ確認画面で確定します。
        </p>
      </header>
      <UploadForm />
    </main>
  );
}
