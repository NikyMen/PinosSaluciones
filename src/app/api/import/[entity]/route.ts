import { readSheet } from "read-excel-file/node";
import { entities,type Entity } from "@/lib/constants";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { modelByEntity } from "@/lib/models";
import { schemas } from "@/lib/schemas";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";

function parseCsv(text:string){const result:string[][]=[];let row:string[]=[];let cell="";let quoted=false;for(let i=0;i<text.length;i++){const char=text[i];if(char==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(char===","&&!quoted){row.push(cell);cell=""}else if((char==="\n"||char==="\r")&&!quoted){if(char==="\r"&&text[i+1]==="\n")i++;row.push(cell);if(row.some(Boolean))result.push(row);row=[];cell=""}else cell+=char}row.push(cell);if(row.some(Boolean))result.push(row);return result}

export async function POST(request:Request,context:RouteContext<"/api/import/[entity]">){
  try{
    const session=await requireSession();const{entity}=await context.params;
    if(!entities.includes(entity as Entity)||!canWrite(session.role,entity as Entity))throw new Error("FORBIDDEN");
    const form=await request.formData();const file=form.get("file");
    if(!(file instanceof File)||file.size>5*1024*1024)return Response.json({error:"Archivo inválido o mayor a 5 MB"},{status:400});
    const extension=file.name.toLowerCase().split(".").pop();let matrix:unknown[][]=[];
    if(extension==="csv")matrix=parseCsv(await file.text());
    else if(extension==="xlsx")matrix=await readSheet(Buffer.from(await file.arrayBuffer()));
    else return Response.json({error:"Formato permitido: .xlsx o .csv"},{status:400});
    if(matrix.length<2)return Response.json({error:"El archivo no contiene datos"},{status:400});
    const headers=matrix[0].map(x=>String(x).trim());const rows=matrix.slice(1).map(values=>Object.fromEntries(headers.map((key,index)=>[key,values[index]??""])));
    if(rows.length>2000)return Response.json({error:"Máximo 2.000 filas por importación"},{status:400});
    await connectDB();const model=modelByEntity[entity as Entity];const errors:Array<{row:number;error:string}>=[];let imported=0;
    for(let index=0;index<rows.length;index++){
      const row={...rows[index]};for(const key of Object.keys(row))if(key.endsWith("Cents"))row[key]=Math.round(Number(row[key]||0)*100);
      const parsed=schemas[entity as Entity].safeParse(row);if(!parsed.success){errors.push({row:index+2,error:parsed.error.issues.map(x=>`${x.path.join(".")}: ${x.message}`).join("; ")});continue}
      try{const item=await model.create(parsed.data as never);await audit(session,"import",entity,item._id,null,item.toObject());imported++}catch(error){errors.push({row:index+2,error:error instanceof Error?error.message:"Error al guardar"})}
    }
    return Response.json({imported,errors,total:rows.length});
  }catch(error){return apiError(error)}
}
