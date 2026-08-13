import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";
const mime:Record<string,string>={".pdf":"application/pdf",".jpg":"image/jpeg",".png":"image/png",".webp":"image/webp",".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};
export async function GET(_request:Request,context:RouteContext<"/api/uploads/[name]">){try{await requireSession();const{name}=await context.params;if(name!==path.basename(name)||!/^[a-f\d-]+\.(pdf|jpg|png|webp|xlsx)$/i.test(name))return Response.json({error:"Archivo inválido"},{status:400});const directory=process.env.UPLOAD_DIR||path.join(process.cwd(),".uploads");const source=path.join(/* turbopackIgnore: true */ directory,name);const file=await readFile(/* turbopackIgnore: true */ source);return new Response(file,{headers:{"content-type":mime[path.extname(name)]||"application/octet-stream","cache-control":"private, max-age=3600"}})}catch(error){if(error instanceof Error&&"code" in error&&(error as NodeJS.ErrnoException).code==="ENOENT")return Response.json({error:"No encontrado"},{status:404});return apiError(error)}}
