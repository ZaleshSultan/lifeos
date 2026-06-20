import { Bot, Database, ServerCog, ShieldCheck } from "lucide-react";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { SectionPanel } from "@/components/SectionPanel";
import { getSystemStatus } from "@/lib/system-status";

export default async function SettingsPage() {
  const systemStatus = await getSystemStatus();

  const envVars = [
    {
      key: "LIFEOS_API_BASE_URL",
      value: systemStatus.apiBaseUrl ?? "not-set",
      set: !!systemStatus.apiBaseUrl,
    },
    {
      key: "NEXT_PUBLIC_LIFEOS_API_BASE_URL",
      value: process.env.NEXT_PUBLIC_LIFEOS_API_BASE_URL ?? "not-set",
      set: !!process.env.NEXT_PUBLIC_LIFEOS_API_BASE_URL,
    },
  ];

  return (
    <>
      <PageHeader
        kicker="System"
        summary="Deployment and integration settings belong in environment variables, Supabase policies, and backend-only secrets."
        title="Settings"
      />

      <div className="dashboard-grid">
        <MetricCard
          detail={
            systemStatus.apiBaseUrl ??
            "Set LIFEOS_API_BASE_URL for server checks."
          }
          icon={ServerCog}
          label="Backend API"
          tone={systemStatus.online ? "mint" : "amber"}
          value={systemStatus.online ? "Online" : "Check"}
        />
        <MetricCard
          detail="Service role usage stays inside apps/bot and trusted workers."
          icon={Database}
          label="Supabase"
          value="Server"
        />
        <MetricCard
          detail="Bot webhooks call the backend; TMA opens with Telegram init data."
          icon={Bot}
          label="Telegram"
          tone="violet"
          value="Webhook"
        />
        <MetricCard
          detail="No service-role keys, ingest secrets, or bot tokens are shipped to web clients."
          icon={ShieldCheck}
          label="Security"
          tone="mint"
          value="Scoped"
        />
      </div>

      <div className="mt-6">
        <SectionPanel eyebrow="Environment" title="Web Runtime Variables">
          <div className="space-y-2">
            {envVars.map((env) => (
              <div
                key={env.key}
                className="flex items-stretch overflow-hidden rounded-lg border border-white/[0.06] bg-black/20"
              >
                {/* Key */}
                <div className="flex items-center border-r border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <span className="font-mono text-[12px] font-medium text-zinc-400 whitespace-nowrap">
                    {env.key}
                  </span>
                </div>
                {/* Value */}
                <div className="flex flex-1 items-center justify-between gap-3 px-4 py-3">
                  <span
                    className={
                      env.set
                        ? "font-mono text-[12px] text-zinc-300 truncate"
                        : "font-mono text-[12px] text-zinc-600 italic"
                    }
                  >
                    {env.value}
                  </span>
                  <span
                    className={
                      env.set
                        ? "shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2 py-0.5 text-[11px] font-medium text-emerald-400"
                        : "shrink-0 rounded-full border border-zinc-700 bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium text-zinc-600"
                    }
                  >
                    {env.set ? "set" : "missing"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
    </>
  );
}
