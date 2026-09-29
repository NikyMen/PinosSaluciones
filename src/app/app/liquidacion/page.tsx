import { notFound } from "next/navigation";
import { PayrollView } from "@/components/payroll-view";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";

export default async function PayrollPage() {
  const session = await requireSession();
  if (!canRead(session, "workers")) notFound();
  return <PayrollView canEdit={canWrite(session, "workers")} />;
}
