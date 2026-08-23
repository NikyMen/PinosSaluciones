import { describe,expect,it } from "vitest";
import { canDelete,canRead,canWrite } from "../src/lib/permissions";
import { money,titleCase } from "../src/lib/format";
import { schemas } from "../src/lib/schemas";

describe("reglas del ERP",()=>{it("restringe escritura por rol",()=>{expect(canWrite("ventas","quotes")).toBe(true);expect(canWrite("ventas","payments")).toBe(false);expect(canDelete("gerencia")).toBe(true);expect(canDelete("administracion")).toBe(false)});it("respeta permisos individuales",()=>{const user={role:"arquitecto" as const,permissions:{view:["works" as const],edit:[]}};expect(canRead(user,"works")).toBe(true);expect(canRead(user,"clients")).toBe(false);expect(canWrite(user,"works")).toBe(false)});it("valida importes en centavos",()=>{expect(schemas.collections.safeParse({clientId:"507f1f77bcf86cd799439011",date:"2026-08-13",amountCents:150000,method:"transferencia"}).success).toBe(true);expect(schemas.collections.safeParse({clientId:"x",date:"2026-08-13",amountCents:-1,method:"efectivo"}).success).toBe(false)});it("formatea valores para Argentina",()=>{expect(money(100000)).toContain("1.000");expect(titleCase("en_curso")).toBe("En curso")})});

const quote={clientId:"507f1f77bcf86cd799439011",title:"Revoque exterior",version:1,amountCents:100000,status:"borrador"};
describe("cotizaciones",()=>{
  it("acepta que no venga número: lo genera el servidor",()=>{const parsed=schemas.quotes.safeParse(quote);expect(parsed.success).toBe(true);expect(parsed.data?.number).toBeUndefined()});
  it("descarta un número vacío en vez de guardarlo",()=>{const parsed=schemas.quotes.safeParse({...quote,number:"   "});expect(parsed.success).toBe(true);expect(parsed.data?.number).toBeUndefined()});
  it("respeta el número si viene cargado",()=>{expect(schemas.quotes.safeParse({...quote,number:"COT-747"}).data?.number).toBe("COT-747")});
  it("admite el estado convertida",()=>{expect(schemas.quotes.safeParse({...quote,status:"convertida"}).success).toBe(true)});
  it("rechaza un estado inventado",()=>{expect(schemas.quotes.safeParse({...quote,status:"archivada"}).success).toBe(false)});
});
