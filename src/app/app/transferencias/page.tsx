import { notFound } from "next/navigation";
import { TransfersView } from "@/components/transfers-view";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";

export default async function TransfersPage() {
  const session = await requireSession();
  if (!canRead(session, "stock")) notFound();
  return <TransfersView canEdit={canWrite(session, "stock")} />;
}
