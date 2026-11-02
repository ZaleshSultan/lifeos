export default function Loading() {
  return (
    <div aria-live="polite" aria-busy="true" className="space-y-4">
      <p className="text-sm text-zinc-300">Загружаем LifeOS…</p>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-xl border border-white/[0.08] bg-white/[0.03]"
        />
      ))}
    </div>
  );
}
