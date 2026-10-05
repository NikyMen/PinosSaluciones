import { notFound } from "next/navigation";
import { AuditLogView } from "@/components/audit-log";
import { requireSession } from "@/lib/auth";

export default async function AuditPage() {
  const session = await requireSession();
  if (session.role !== "gerencia") notFound();
  return <AuditLogView />;
}
