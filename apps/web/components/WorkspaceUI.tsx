"use client";
import { useEffect, useState } from "react";
import { webRequest, webErrorMessage } from "@/lib/web-client";

export const inputClass =
  "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-white/15 bg-graphite-950 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-400 disabled:opacity-60";
export const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:bg-white/[0.06] active:scale-[0.98] disabled:opacity-50";
export const rowClass =
  "min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3";
export function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={`rounded-lg border p-3 text-sm leading-relaxed ${error ? "border-rose-400/25 bg-rose-400/[0.05] text-rose-100" : "border-white/[0.08] bg-white/[0.02] text-zinc-300"}`}
    >
      {children}
    </div>
  );
}
export function useWebResource<T>(resource: string, initial: T | null) {
  const [data, setData] = useState<T | null>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    initial === null ? "Данные пока недоступны. Повтори загрузку." : null,
  );
  async function reload() {
    setBusy(true);
    setError(null);
    try {
      const next = await webRequest<T>(resource);
      setData(next);
      return next;
    } catch (e) {
      setError(webErrorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { data, setData, busy, error, setError, reload };
}
export function useUnsavedGuard(dirty: boolean, retained = false) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const navigate = (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        !retained &&
        target &&
        target.getAttribute("href")?.startsWith("/") &&
        !window.confirm("Есть несохранённые изменения. Перейти и отменить их?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty, retained]);
}
