import { notFound } from "next/navigation";
import { CalendarView } from "@/components/calendar";
import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";

export default async function CalendarioPage() {
  const session = await requireSession();
  if (!canViewSection(session, "calendario")) notFound();
  return <CalendarView isManager={session.role === "gerencia"} />;
}
