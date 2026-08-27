import { describe,expect,it } from "vitest";
import { canDelete,canRead,canWrite } from "../src/lib/permissions";
import { money,titleCase } from "../src/lib/format";
import { schemas } from "../src/lib/schemas";
import { entityConfig } from "../src/lib/entity-config";
import { computeLabor,dailyRateCents,hourlyRateCents } from "../src/lib/labor";
import { canSeeTask,taskScope } from "../src/lib/tasks";
import type { AuthorizedSession } from "../src/lib/auth";

describe("reglas del ERP",()=>{it("restringe escritura por rol",()=>{expect(canWrite("ventas","quotes")).toBe(true);expect(canWrite("ventas","payments")).toBe(false);expect(canDelete("gerencia")).toBe(true);expect(canDelete("administracion")).toBe(false)});it("respeta permisos individuales",()=>{const user={role:"arquitecto" as const,permissions:{view:["works" as const],edit:[]}};expect(canRead(user,"works")).toBe(true);expect(canRead(user,"clients")).toBe(false);expect(canWrite(user,"works")).toBe(false)});it("valida importes en centavos",()=>{expect(schemas.collections.safeParse({clientId:"507f1f77bcf86cd799439011",date:"2026-08-13",amountCents:150000,method:"transferencia"}).success).toBe(true);expect(schemas.collections.safeParse({clientId:"x",date:"2026-08-13",amountCents:-1,method:"efectivo"}).success).toBe(false)});it("formatea valores para Argentina",()=>{expect(money(100000)).toContain("1.000");expect(titleCase("en_curso")).toBe("En curso")})});

const quote={clientId:"507f1f77bcf86cd799439011",title:"Revoque exterior",version:1,amountCents:100000,status:"borrador"};
describe("cotizaciones",()=>{
  it("acepta que no venga número: lo genera el servidor",()=>{const parsed=schemas.quotes.safeParse(quote);expect(parsed.success).toBe(true);expect(parsed.data?.number).toBeUndefined()});
  it("descarta un número vacío en vez de guardarlo",()=>{const parsed=schemas.quotes.safeParse({...quote,number:"   "});expect(parsed.success).toBe(true);expect(parsed.data?.number).toBeUndefined()});
  it("respeta el número si viene cargado",()=>{expect(schemas.quotes.safeParse({...quote,number:"COT-747"}).data?.number).toBe("COT-747")});
  it("admite el estado convertida",()=>{expect(schemas.quotes.safeParse({...quote,status:"convertida"}).success).toBe(true)});
  it("rechaza un estado inventado",()=>{expect(schemas.quotes.safeParse({...quote,status:"archivada"}).success).toBe(false)});
  it("no ofrece aprobada ni convertida para elegir a mano: eso sale del botón Aprobar y del pase a obra",()=>{
    const status=entityConfig.quotes.fields.find(field=>field.key==="status");
    expect(status?.options).not.toContain("aprobada");
    expect(status?.options).not.toContain("convertida");
    expect(status?.defaultValue).toBe("borrador");
  });
  it("deja la versión en manos del sistema y propone siete días de validez",()=>{
    expect(entityConfig.quotes.fields.find(field=>field.key==="version")?.readOnly).toBe(true);
    const validUntil=entityConfig.quotes.fields.find(field=>field.key==="validUntil");
    expect(validUntil?.defaultInDays).toBe(7);
    expect(validUntil?.hideToday).toBe(true);
  });
});

describe("mano de obra",()=>{
  it("por jornada convierte a horas y calcula el importe",()=>{const parte=computeLabor({mode:"jornada",quantity:1.5,rateCents:40000,hoursPerDay:8});expect(parte.hours).toBe(12);expect(parte.costCents).toBe(60000);expect(parte.hourlyRateCents).toBe(5000)});
  it("por hora convierte a jornadas y calcula el importe",()=>{const parte=computeLabor({mode:"hora",quantity:6,rateCents:5000,hoursPerDay:8});expect(parte.days).toBe(0.75);expect(parte.costCents).toBe(30000);expect(parte.dailyRateCents).toBe(40000)});
  it("saca el valor hora del jornal cuando no esta cargado",()=>{expect(hourlyRateCents({dailyRateCents:40000,hoursPerDay:8})).toBe(5000);expect(dailyRateCents({hourlyRateCents:5000,hoursPerDay:9})).toBe(45000)});
  it("usa 8 horas por jornada si el dato no sirve",()=>{expect(hourlyRateCents({dailyRateCents:40000,hoursPerDay:0})).toBe(5000)});
});

const viewer=(role:string,userId:string)=>({role,userId,name:"x",email:"x",permissions:{view:[],edit:[]}}) as unknown as AuthorizedSession;
const compras=viewer("compras","6a8a5c894354e8906f53ee7b");
const gerencia=viewer("gerencia","6a8a5c894354e8906f53ee7c");

describe("qué tareas ve cada uno",()=>{
  it("fuera de gerencia, sin filtro: lo del área y lo propio",()=>{expect(taskScope(compras,new URLSearchParams())).toEqual({$or:[{assigneeId:compras.userId},{assigneeRole:"compras"}]})});
  it("el botón «asignadas a mí» deja solo las suyas",()=>{expect(taskScope(compras,new URLSearchParams("scope=mine"))).toEqual({assigneeId:compras.userId})});
  it("el botón «mi área» deja solo las del área",()=>{expect(taskScope(compras,new URLSearchParams("scope=area"))).toEqual({assigneeRole:"compras"})});
  it("no deja que otro rol se cuele filtrando por área ajena",()=>{expect(taskScope(compras,new URLSearchParams("assigneeRole=gerencia"))).toEqual({$or:[{assigneeId:compras.userId},{assigneeRole:"compras"}]})});
  it("gerencia sin filtro ve todo",()=>{expect(taskScope(gerencia,new URLSearchParams())).toEqual({})});
  it("gerencia filtra por área y por persona",()=>{expect(taskScope(gerencia,new URLSearchParams("assigneeRole=contador&assigneeId=6a8a5c894354e8906f53ee7b"))).toEqual({$and:[{assigneeRole:"contador"},{assigneeId:"6a8a5c894354e8906f53ee7b"}]})});
  it("ignora un área inventada",()=>{expect(taskScope(gerencia,new URLSearchParams("assigneeRole=marketing"))).toEqual({})});
  it("una tarea de otra área no se abre por id",()=>{expect(canSeeTask(compras,{assigneeRole:"contador"})).toBe(false);expect(canSeeTask(compras,{assigneeRole:"contador",assigneeId:compras.userId})).toBe(true);expect(canSeeTask(gerencia,{assigneeRole:"contador"})).toBe(true)});
});
