import { notFound } from "next/navigation";
import { PurchaseRouteView } from "@/components/purchase-route-view";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";

export default async function PurchaseRoutePage() {
  const session = await requireSession();
  if (!canRead(session, "purchases")) notFound();
  return <PurchaseRouteView />;
}
