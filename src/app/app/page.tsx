import { Dashboard } from "@/components/dashboard";
import { redirect } from "next/navigation";
import { entities } from "@/lib/constants";
import { requireSession } from "@/lib/auth";
import { canRead, canViewSection } from "@/lib/permissions";
export default async function DashboardPage() {
  const session = await requireSession();
  if (!canViewSection(session, "dashboard")) {
    const firstEntity = entities.find(entity => canRead(session, entity));
    if (firstEntity) redirect(`/app/${firstEntity}`);
    if (canViewSection(session, "reports")) redirect("/app/reports");
    if (session.role === "gerencia") redirect("/app/settings");
    return <section className="panel no-access-panel"><h1>Sin secciones habilitadas</h1><p>Pedile a Gerencia que revise tus permisos de acceso.</p></section>;
  }
  return <Dashboard/>;
}
