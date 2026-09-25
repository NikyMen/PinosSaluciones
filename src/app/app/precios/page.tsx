import { notFound } from "next/navigation";
import { PriceSearch } from "@/components/price-search";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";

export default async function PricesPage() {
  const session = await requireSession();
  if (!canRead(session, "suppliers")) notFound();
  return <PriceSearch />;
}
