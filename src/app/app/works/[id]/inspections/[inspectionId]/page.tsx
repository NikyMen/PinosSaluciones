import { notFound } from "next/navigation";
import { InspectionForm } from "@/components/inspection-form";
import { requireSession } from "@/lib/auth";
import { canRead } from "@/lib/permissions";

export default async function InspectionPage({ params }: { params: Promise<{ id: string; inspectionId: string }> }) {
  const session = await requireSession();
  if (!canRead(session, "works")) notFound();
  const { id, inspectionId } = await params;
  return <InspectionForm workId={id} inspectionId={inspectionId} />;
}
