import mongoose from "mongoose";

const uri=process.env.MONGODB_URI?.trim();const interval=Math.max(60000,Number(process.env.WORKER_INTERVAL_MS||300000));const timeout=Math.max(1000,Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS||5000));
if(!uri)throw new Error("Falta MONGODB_URI");
const Task=mongoose.models.Task||mongoose.model("Task",new mongoose.Schema({title:String,description:String,type:String,status:String,dueDate:Date,assigneeRole:String,relatedType:String,relatedId:mongoose.Schema.Types.ObjectId},{timestamps:true}));
const Invoice=mongoose.models.Invoice||mongoose.model("Invoice",new mongoose.Schema({number:String,dueDate:Date,status:String},{strict:false}));
const Check=mongoose.models.Check||mongoose.model("Check",new mongoose.Schema({number:String,dueDate:Date,status:String},{strict:false}));
async function ensureTask(title,type,relatedType,relatedId,dueDate){await Task.updateOne({type,relatedType,relatedId,status:{$ne:"completada"}},{$setOnInsert:{title,type,relatedType,relatedId,dueDate,status:"pendiente",assigneeRole:"administracion"}},{upsert:true})}
async function run(){const now=new Date();const horizon=new Date(now.getTime()+7*86400000);const[invoices,checks]=await Promise.all([Invoice.find({dueDate:{$lte:horizon},status:{$in:["pendiente","parcial"]}}).lean(),Check.find({dueDate:{$lte:horizon},status:{$in:["cartera","emitido"]}}).lean()]);await Promise.all([...invoices.map(x=>ensureTask(`Revisar cobranza de factura ${x.number}`,"cobranza","invoices",x._id,x.dueDate)),...checks.map(x=>ensureTask(`Cheque ${x.number} próximo a vencer`,"vencimiento","checks",x._id,x.dueDate))]);console.log(`[worker] ${new Date().toISOString()} alertas actualizadas`)}
try { await mongoose.connect(uri,{maxPoolSize:5,serverSelectionTimeoutMS:timeout}); } catch (error) { const message=error instanceof Error?error.message.split("\n")[0]:"error desconocido"; console.error(`[worker] MongoDB no disponible: ${message}`); process.exit(1); }
await run();setInterval(()=>run().catch(error=>console.error("[worker]",error)),interval);
process.on("SIGINT",async()=>{await mongoose.disconnect();process.exit(0)});process.on("SIGTERM",async()=>{await mongoose.disconnect();process.exit(0)});
