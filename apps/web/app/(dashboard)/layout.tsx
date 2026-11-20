import { redirect } from "next/navigation";
import { WebQueryProvider } from "@/components/WebQueryProvider";
import { AppShell } from "@/components/AppShell";
import { getSystemStatus } from "@/lib/system-status";
import { lifeosApi, type WebSessionStatus } from "@/lib/lifeos-api";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [systemStatus, session] = await Promise.all([
    getSystemStatus(),
    lifeosApi<WebSessionStatus>("/api/tma/session"),
  ]);

  if (!session || session.state !== "active") {
    redirect("/access");
  }

  return (
    <WebQueryProvider
      key={session.telegramUserId}
      owner={session.telegramUserId}
    >
      <AppShell online={systemStatus.online} userName={session.displayName}>
        {children}
      </AppShell>
    </WebQueryProvider>
  );
}
