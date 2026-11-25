import iconv from "iconv-lite";
import { createHash } from "crypto";
import { MF_COLUMNS } from "./constants";

/** Base64 of CP932 CSV header line ending with CRLF (for browser Blob download). */
export function mfHeaderBase64(): string {
  const header = MF_COLUMNS.join(",") + "\r\n";
  return iconv.encode(header, "cp932").toString("base64");
}

export function fingerprintPayload(json: string): string {
  return createHash("sha256").update(json).digest("hex");
}
