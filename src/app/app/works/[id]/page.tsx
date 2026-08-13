import { WorkDetail } from "@/components/work-detail";
export default async function WorkPage({params}:{params:Promise<{id:string}>}){return <WorkDetail id={(await params).id}/>}
