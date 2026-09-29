import { notFound } from "next/navigation";
import { StockCounter } from "@/components/stock-counter";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";

export default async function CounterPage() {
  const session = await requireSession();
  if (!canRead(session, "stock")) notFound();
  // Mover stock es escribir en el stock: quien sólo lo mira ve el aviso, no la caja.
  return <StockCounter canEdit={canWrite(session, "stock")} />;
}
