import { notFound } from "next/navigation";
import { SupplierPriceLists } from "@/components/supplier-price-lists";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!canRead(session, "suppliers")) notFound();
  return <SupplierPriceLists id={(await params).id} canEdit={canWrite(session, "suppliers")} />;
}
