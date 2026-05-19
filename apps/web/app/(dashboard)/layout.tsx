import { AppShell } from "@/components/AppShell";
import { getSystemStatus } from "@/lib/system-status";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const systemStatus = await getSystemStatus();

  return <AppShell systemStatus={systemStatus}>{children}</AppShell>;
}
