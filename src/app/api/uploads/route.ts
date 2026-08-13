import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth";
import { apiError } from "@/lib/api";

const allowed=new Set(["application/pdf","image/jpeg","image/png","image/webp","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
export async function POST(request:Request){try{await requireSession();const form=await request.formData();const file=form.get("file");if(!(file instanceof File)||file.size===0||file.size>10*1024*1024)return Response.json({error:"Archivo inválido o mayor a 10 MB"},{status:400});if(!allowed.has(file.type))return Response.json({error:"Formato no permitido"},{status:400});const directory=process.env.UPLOAD_DIR||path.join(process.cwd(),".uploads");await mkdir(/* turbopackIgnore: true */ directory,{recursive:true});const extensions:Record<string,string>={"application/pdf":".pdf","image/jpeg":".jpg","image/png":".png","image/webp":".webp","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":".xlsx"};const name=randomUUID()+extensions[file.type];const destination=path.join(/* turbopackIgnore: true */ directory,name);await writeFile(/* turbopackIgnore: true */ destination,Buffer.from(await file.arrayBuffer()),{flag:"wx"});return Response.json({path:`/api/uploads/${name}`},{status:201});}catch(error){return apiError(error)}}
