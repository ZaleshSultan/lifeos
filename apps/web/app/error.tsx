"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section
      role="alert"
      className="rounded-xl border border-rose-400/25 bg-rose-400/[0.05] p-5"
    >
      <h2 className="text-lg font-semibold text-white">
        Не удалось загрузить раздел
      </h2>
      <p className="mt-2 text-sm text-zinc-300">
        Данные остаются в LifeOS. Проверь подключение и повтори попытку.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 min-h-11 rounded-lg border border-white/15 px-4 text-sm text-white"
      >
        Повторить
      </button>
    </section>
  );
}
