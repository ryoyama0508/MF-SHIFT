import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 py-16">
      <header className="mb-8 text-center">
        <h1 className="text-2xl font-semibold text-[#173831] sm:text-3xl">メディカルフォースシフト変換ツール</h1>
        <p className="mt-3 text-sm text-[#4d635c]">利用するにはパスワードを入力してください。</p>
      </header>
      <LoginForm />
    </main>
  );
}
