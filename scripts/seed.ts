import bcrypt from "bcryptjs";
import { connectDB } from "../src/lib/db";
import { User } from "../src/lib/models";

async function main(){const email=(process.env.ADMIN_EMAIL||"admin@pinos.local").toLowerCase();const password=process.env.ADMIN_PASSWORD;if(!password||password.length<8)throw new Error("ADMIN_PASSWORD debe tener al menos 8 caracteres");await connectDB();const existing=await User.findOne({email});if(existing){console.log(`El usuario ${email} ya existe`);process.exit(0)}await User.create({name:"Administrador",email,passwordHash:await bcrypt.hash(password,12),role:"gerencia",active:true});console.log(`Usuario administrador creado: ${email}`);process.exit(0)}
main().catch(error=>{console.error(error);process.exit(1)});
