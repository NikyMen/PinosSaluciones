import { notFound } from "next/navigation";
import { CashStatementView } from "@/components/cash-statement-view";
import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";

export default async function CashStatementPage() {
  const session = await requireSession();
  if (!canViewSection(session, "cashAccounts") && !canViewSection(session, "accounting")) notFound();
  return <CashStatementView />;
}
