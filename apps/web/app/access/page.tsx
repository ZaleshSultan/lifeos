import { KeyRound, Send, ShieldCheck } from "lucide-react";

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const invalid = params.error === "invalid";

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-12">
      <section className="w-full rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 shadow-2xl">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
          <KeyRound className="h-5 w-5" />
        </div>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-400/80">
          Personal access
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Твой LifeOS Web
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          Web-панель больше не общая: каждая сессия привязана к конкретному
          LifeOS-пользователю и показывает только его задачи, погоду, учёбу и
          интеграции.
        </p>

        {invalid ? (
          <div className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/[0.08] p-3 text-sm text-rose-200">
            Ссылка истекла или недействительна. Получи новую через Telegram.
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          <div className="flex gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3">
            <Send className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
            <div>
              <div className="text-sm font-medium text-zinc-100">1. Открой бота</div>
              <div className="mt-1 text-xs text-zinc-500">
                Отправь команду <code className="text-zinc-300">/web</code> или нажми кнопку Web.
              </div>
            </div>
          </div>
          <div className="flex gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <div>
              <div className="text-sm font-medium text-zinc-100">2. Открой личную ссылку</div>
              <div className="mt-1 text-xs text-zinc-500">
                Она создаст защищённую HttpOnly-сессию этого браузера.
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
