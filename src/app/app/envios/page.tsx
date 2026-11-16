import { notFound } from "next/navigation";
import { ShipmentsView } from "@/components/shipments-view";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";

export default async function ShipmentsPage() {
  const session = await requireSession();
  if (!canRead(session, "stock")) notFound();
  return <ShipmentsView canEdit={canWrite(session, "stock")} />;
}
