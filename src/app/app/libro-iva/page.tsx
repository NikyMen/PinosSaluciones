import { notFound } from "next/navigation";
import { IvaBook } from "@/components/iva-book";
import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";

export default async function IvaBookPage() {
  const session = await requireSession();
  if (!canViewSection(session, "accounting")) notFound();
  return <IvaBook />;
}
