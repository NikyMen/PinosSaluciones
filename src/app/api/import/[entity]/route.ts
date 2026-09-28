import { readSheet } from "read-excel-file/node";
import { entities,type Entity } from "@/lib/constants";
import { entityConfig, columnLabels } from "@/lib/entity-config";
import { requireSession } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { modelByEntity } from "@/lib/models";
import { schemas } from "@/lib/schemas";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";

function parseCsv(text:string){text=text.replace(/^﻿/,"");const firstLine=text.split(/\r?\n/,1)[0];const delimiter=firstLine.split(";").length>firstLine.split(",").length?";":",";const result:string[][]=[];let row:string[]=[];let cell="";let quoted=false;for(let i=0;i<text.length;i++){const char=text[i];if(char==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(char===delimiter&&!quoted){row.push(cell);cell=""}else if((char==="\n"||char==="\r")&&!quoted){if(char==="\r"&&text[i+1]==="\n")i++;row.push(cell);if(row.some(Boolean))result.push(row);row=[];cell=""}else cell+=char}row.push(cell);if(row.some(Boolean))result.push(row);return result}

// Excel en Windows guarda los CSV en Latin-1; si no es UTF-8 válido se relee así.
function decodeText(buffer:ArrayBuffer){try{return new TextDecoder("utf-8",{fatal:true}).decode(buffer)}catch{return new TextDecoder("latin1").decode(buffer)}}

// Repara encabezados con doble codificación ("TelÃ©fono" -> "Teléfono") y los compara sin tildes ni mayúsculas.
function fixMojibake(value:string){if(!/[ÃÂ]/.test(value))return value;try{return new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from([...value].map(c=>c.charCodeAt(0)&0xff)))}catch{return value}}
function normalizeHeader(value:string){return fixMojibake(value).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"")}

// Acepta como encabezado la clave del campo o su etiqueta (la que usa la exportación).
function headerMap(entity:Entity){const map=new Map<string,string>();for(const field of entityConfig[entity].fields){map.set(normalizeHeader(field.key),field.key);map.set(normalizeHeader(field.label),field.key)}for(const[key,label]of Object.entries(columnLabels))if(!map.has(normalizeHeader(label)))map.set(normalizeHeader(label),key);return map}

// Las categorías propias de la empresa (Silletero 1, Sereno, M.O Altura...) se llevan a la del sistema y la original queda en las notas.
function workerCategory(row:Record<string,unknown>){const raw=String(row.category??"").trim();if(!raw)return;const n=normalizeHeader(raw);const category=n.includes("capataz")?"capataz":n.includes("medio")||n.startsWith("mo")?"medio_oficial":n.includes("ayudante")?"ayudante":n.includes("oficial")?"oficial":"especialista";row.category=category;if(normalizeHeader(category)!==n){const notes=String(row.notes??"").trim();row.notes=notes?`Categoría: ${raw}. ${notes}`:`Categoría: ${raw}`}}

export async function POST(request:Request,context:RouteContext<"/api/import/[entity]">){
  try{
    const session=await requireSession();const{entity}=await context.params;
    if(!entities.includes(entity as Entity)||!canWrite(session,entity as Entity))throw new Error("FORBIDDEN");
    const form=await request.formData();const file=form.get("file");
    if(!(file instanceof File)||file.size>5*1024*1024)return Response.json({error:"Archivo inválido o mayor a 5 MB"},{status:400});
    const extension=file.name.toLowerCase().split(".").pop();let matrix:unknown[][]=[];
    if(extension==="csv")matrix=parseCsv(decodeText(await file.arrayBuffer()));
    else if(extension==="xlsx")matrix=await readSheet(Buffer.from(await file.arrayBuffer()));
    else return Response.json({error:"Formato permitido: .xlsx o .csv"},{status:400});
    if(matrix.length<2)return Response.json({error:"El archivo no contiene datos"},{status:400});
    const known=headerMap(entity as Entity);const headers=matrix[0].map(x=>known.get(normalizeHeader(String(x).trim())));
    if(!headers.some(Boolean))return Response.json({error:"No se reconocieron las columnas del archivo. Usá los mismos encabezados que la exportación a Excel."},{status:400});
    // Las celdas vacías se omiten para que tomen el valor por defecto; las columnas desconocidas (Creado el, etc.) se ignoran.
    const rows=matrix.slice(1).map(values=>Object.fromEntries(headers.flatMap((key,index)=>{const value=values[index];return key&&value!==undefined&&value!==null&&String(value).trim()!==""?[[key,typeof value==="string"?value.trim():value]]:[]})));
    if(rows.length>2000)return Response.json({error:"Máximo 2.000 filas por importación"},{status:400});
    await connectDB();const model=modelByEntity[entity as Entity];const errors:Array<{row:number;error:string}>=[];let imported=0;
    for(let index=0;index<rows.length;index++){
      const row={...rows[index]};for(const key of Object.keys(row))if(key.endsWith("Cents")){const value=typeof row[key]==="string"?String(row[key]).replace(/[$\s]/g,"").replace(/\.(?=\d{3}(\D|$))/g,"").replace(",","."):row[key];row[key]=Math.round(Number(value||0)*100)}
      if(entity==="workers"){workerCategory(row);if(row.dni!==undefined)row.dni=String(row.dni);if(row.phone!==undefined)row.phone=String(row.phone);if(typeof row.rateMode==="string")row.rateMode=row.rateMode.toLowerCase()}
      const parsed=schemas[entity as Entity].safeParse(row);if(!parsed.success){errors.push({row:index+2,error:parsed.error.issues.map(x=>`${x.path.join(".")}: ${x.message}`).join("; ")});continue}
      try{const item=await model.create(parsed.data as never);await audit(session,"import",entity,item._id,null,item.toObject());imported++}catch(error){errors.push({row:index+2,error:error instanceof Error?error.message:"Error al guardar"})}
    }
    return Response.json({imported,errors,total:rows.length});
  }catch(error){return apiError(error)}
}
