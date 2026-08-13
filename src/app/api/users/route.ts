import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { ROLES } from "@/lib/constants";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/api";
const schema=z.object({name:z.string().trim().min(2),email:z.email().trim().toLowerCase(),password:z.string().min(8),role:z.enum(ROLES)});
export async function GET(){try{const session=await requireSession();if(session.role!=="gerencia")throw new Error("FORBIDDEN");await connectDB();return Response.json({items:await User.find().select("name email role active createdAt").sort({name:1}).lean()});}catch(error){return apiError(error)}}
export async function POST(request:Request){try{const session=await requireSession();if(session.role!=="gerencia")throw new Error("FORBIDDEN");const parsed=schema.safeParse(await request.json());if(!parsed.success)return Response.json({error:"Datos inválidos. La contraseña debe tener al menos 8 caracteres."},{status:400});await connectDB();const{password,...data}=parsed.data;const user=await User.create({...data,passwordHash:await bcrypt.hash(password,12),active:true});await audit(session,"create","users",user._id,null,{name:user.name,email:user.email,role:user.role});return Response.json({name:user.name,email:user.email,role:user.role,active:user.active},{status:201});}catch(error){return apiError(error)}}
