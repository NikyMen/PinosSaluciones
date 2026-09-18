import { notFound } from "next/navigation";
import { NewInspection } from "@/components/inspection-form";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";

// Lo que abre el ícono "Inspeccionar obra" del listado.
export default async function NewInspectionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!canWrite(session, "works")) notFound();
  return <NewInspection workId={(await params).id} />;
}
