import { notFound } from "next/navigation";
import { CompanyConfig } from "@/components/company-config";
import { requireSession } from "@/lib/auth";

export default async function ConfigPage() {
  const session = await requireSession();
  if (session.role !== "gerencia") notFound();
  return <CompanyConfig />;
}
