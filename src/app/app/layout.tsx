import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { NAV_COOKIE, navVersionOf } from "@/lib/nav-version";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let session; try { session = await requireSession(); } catch { redirect("/login"); }
  const navVersion = navVersionOf((await cookies()).get(NAV_COOKIE)?.value);
  return <AppShell session={session} navVersion={navVersion}>{children}</AppShell>;
}
