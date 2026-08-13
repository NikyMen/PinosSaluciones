import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let session; try { session = await requireSession(); } catch { redirect("/login"); }
  return <AppShell session={session}>{children}</AppShell>;
}
