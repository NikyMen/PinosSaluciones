import { WorkDetail } from "@/components/work-detail";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { canRead, canWrite } from "@/lib/permissions";
export default async function WorkPage({params}:{params:Promise<{id:string}>}){const session=await requireSession();if(!canRead(session,"works"))notFound();return <WorkDetail id={(await params).id} canEdit={canWrite(session,"works")}/>}
