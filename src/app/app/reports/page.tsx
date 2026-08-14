import { Reports } from "@/components/reports";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { canViewSection } from "@/lib/permissions";
export default async function ReportsPage(){const session=await requireSession();if(!canViewSection(session,"reports"))notFound();return <Reports/>;}
