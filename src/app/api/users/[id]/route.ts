import { isValidObjectId } from "mongoose";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { ROLES } from "@/lib/constants";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
const schema=z.object({name:z.string().trim().min(2).optional(),role:z.enum(ROLES).optional(),active:z.boolean().optional()});
export async function PATCH(request:Request,context:RouteContext<"/api/users/[id]">){try{const session=await requireSession();if(session.role!=="gerencia")throw new Error("FORBIDDEN");const{id}=await context.params;if(!isValidObjectId(id))return Response.json({error:"ID inválido"},{status:400});const parsed=schema.safeParse(await request.json());if(!parsed.success)return Response.json({error:"Datos inválidos"},{status:400});if(id===session.userId&&parsed.data.active===false)return Response.json({error:"No podés desactivar tu propia cuenta"},{status:400});await connectDB();const before=await User.findById(id).select("name email role active").lean();const user=await User.findByIdAndUpdate(id,{$set:parsed.data},{new:true}).select("name email role active").lean();if(!user)return Response.json({error:"Usuario no encontrado"},{status:404});await audit(session,"update","users",id,before,user);return Response.json(user);}catch(error){return apiError(error)}}
