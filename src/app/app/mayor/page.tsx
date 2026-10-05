import { notFound } from "next/navigation";
import { LedgerView } from "@/components/ledger-view";
import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";

export default async function LedgerPage() {
  const session = await requireSession();
  if (!canViewSection(session, "accounting")) notFound();
  return <LedgerView />;
}
