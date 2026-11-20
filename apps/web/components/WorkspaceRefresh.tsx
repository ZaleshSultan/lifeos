"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function WorkspaceRefresh({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      aria-label={label}
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-zinc-300 hover:bg-white/[0.06] disabled:opacity-50"
    >
      <RefreshCw aria-hidden="true" size={17} />
    </button>
  );
}
