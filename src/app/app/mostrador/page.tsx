import { notFound } from "next/navigation";
import { CounterSale } from "@/components/counter-sale";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";
import { canSellAtCounter } from "@/lib/counter-sales";

export default async function CounterSalePage() {
  const session = await requireSession();
  if (!canRead(session, "invoices")) notFound();
  // Vender mueve stock, factura y cobra: quien no tiene los tres permisos ve el aviso, no el mostrador.
  return <CounterSale canSell={canSellAtCounter(session)} />;
}
