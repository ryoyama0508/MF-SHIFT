import { AUTH_COOKIE, SESSION_PAYLOAD } from "./auth-shared";

export { AUTH_COOKIE };

export async function sessionTokenEdge(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(SESSION_PAYLOAD));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifySessionTokenEdge(
  token: string | undefined,
  password: string,
): Promise<boolean> {
  if (!token || !password) return false;
  const expected = await sessionTokenEdge(password);
  if (token.length !== expected.length) return false;
  let ok = 0;
  for (let i = 0; i < token.length; i++) {
    ok |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return ok === 0;
}
