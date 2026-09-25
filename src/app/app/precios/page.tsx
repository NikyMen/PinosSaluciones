import { notFound } from "next/navigation";
import { PriceSearch } from "@/components/price-search";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";

export default async function PricesPage() {
  const session = await requireSession();
  if (!canRead(session, "suppliers")) notFound();
  // El pedido termina en una orden de compra: sólo lo arma quien puede cargarlas.
  return <PriceSearch canOrder={canWrite(session, "purchases")} />;
}
