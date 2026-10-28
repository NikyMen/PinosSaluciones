import { notFound } from "next/navigation";
import { WorkDeliveriesView } from "@/components/work-deliveries-view";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";

export default async function WorkDeliveriesPage({ searchParams }: { searchParams: Promise<{ obra?: string | string[] }> }) {
  const session = await requireSession();
  if (!canRead(session, "stock")) notFound();
  // Desde la pantalla de una obra se llega con ?obra=… y el listado arranca filtrado.
  const { obra } = await searchParams;
  return <WorkDeliveriesView initialWorkId={typeof obra === "string" ? obra : ""} />;
}
