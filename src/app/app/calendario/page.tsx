import { notFound } from "next/navigation";
import { Agenda } from "@/components/agenda";
import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";

export default async function CalendarioPage() {
  const session = await requireSession();
  if (!canViewSection(session, "calendario")) notFound();
  return <Agenda isManager={session.role === "gerencia"} />;
}
