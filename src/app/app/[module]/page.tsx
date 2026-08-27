import { notFound } from "next/navigation";
import { entities, type Entity } from "@/lib/constants";
import { EntityManager } from "@/components/entity-manager";
import { requireSession } from "@/lib/auth";
import { canDelete, canRead, canWrite } from "@/lib/permissions";

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params; if (!entities.includes(module as Entity)) notFound();
  const entity = module as Entity;
  const session = await requireSession();
  if (!canRead(session, entity)) notFound();
  // Tareas filtra por area y por persona: el componente necesita saber quien mira.
  return <EntityManager entity={entity} canEdit={canWrite(session, entity)} canDeleteRecords={canDelete(session) && canWrite(session, entity)}
    viewer={{ userId: session.userId, role: session.role }}/>;
}
