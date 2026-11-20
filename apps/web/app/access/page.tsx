import { Send, Zap } from "lucide-react";

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const invalid = (await searchParams).error === "invalid";
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-5 py-12">
      <section className="w-full rounded-2xl border border-white/10 bg-[#151517] p-6 sm:p-8">
        <Zap size={24} aria-hidden="true" className="text-[#89aaff]" />
        <h1 className="mt-4 text-3xl font-bold tracking-tight">
          Твой LifeOS Web
        </h1>
        <p className="mt-3 leading-relaxed text-zinc-300">
          Отправь боту команду <code className="text-white">/web</code> и открой
          личную ссылку в этом браузере.
        </p>
        {invalid && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-rose-950/50 p-3 text-sm text-rose-200"
          >
            Ссылка истекла или недействительна. Запроси новую в Telegram.
          </p>
        )}
        <a
          href="https://t.me/MYlifeeOS_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#28344d] px-4 font-semibold text-[#c6d7ff]"
        >
          <Send size={16} aria-hidden="true" />
          Открыть бота LifeOS
        </a>
      </section>
    </main>
  );
}
