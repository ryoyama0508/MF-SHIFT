"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || "認証に失敗しました");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-sm space-y-4">
      <label className="block text-sm font-medium text-[#173831]">
        パスワード
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-2 w-full rounded-md border border-[#9fb3ac] bg-white px-3 py-2"
          required
        />
      </label>
      {error && (
        <p className="rounded-md border border-[#e8c4bb] bg-[#fff5f2] px-3 py-2 text-sm text-[#91331e]" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading || !password}
        className="w-full rounded-md bg-[#16594b] px-4 py-2.5 text-white disabled:cursor-not-allowed disabled:opacity-45"
      >
        {loading ? "確認中…" : "入室する"}
      </button>
    </form>
  );
}
