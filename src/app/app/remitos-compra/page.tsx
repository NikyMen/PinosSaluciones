import { notFound } from "next/navigation";
import { PurchaseReceiptsView } from "@/components/purchase-receipts-view";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";

export default async function PurchaseReceiptsPage() {
  const session = await requireSession();
  if (!canRead(session, "purchases")) notFound();
  return <PurchaseReceiptsView canReceive={canWrite(session, "purchases") && canWrite(session, "stock")} />;
}
