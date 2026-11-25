import { createHmac, timingSafeEqual } from "crypto";
import { SESSION_PAYLOAD } from "./auth-shared";

export { AUTH_COOKIE } from "./auth-shared";

export function sessionToken(password: string): string {
  return createHmac("sha256", password).update(SESSION_PAYLOAD).digest("hex");
}

export function verifySessionToken(token: string | undefined, password: string): boolean {
  if (!token || !password) return false;
  const expected = sessionToken(password);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
