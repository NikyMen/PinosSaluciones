import { notFound } from "next/navigation";
import { TrackingView } from "@/components/tracking-view";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";

export default async function TrackingPage() {
  const session = await requireSession();
  if (!canRead(session, "invoices")) notFound();
  return <TrackingView />;
}
