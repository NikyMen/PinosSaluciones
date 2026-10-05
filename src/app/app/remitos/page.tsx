import { notFound } from "next/navigation";
import { SalesRemitosView } from "@/components/sales-remitos-view";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";

export default async function SalesRemitosPage() {
  const session = await requireSession();
  if (!canRead(session, "stock")) notFound();
  return <SalesRemitosView canEdit={canWrite(session, "stock")} canInvoice={canWrite(session, "invoices")} />;
}
