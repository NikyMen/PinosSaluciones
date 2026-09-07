import { QuoteCascade } from "@/components/quote-cascade";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
export default async function QuotePage({params}:{params:Promise<{id:string}>}){const session=await requireSession();if(!canRead(session,"quotes"))notFound();return <QuoteCascade id={(await params).id} canEdit={canWrite(session,"quotes")} canForceUnlock={session.role==="gerencia"}/>}
