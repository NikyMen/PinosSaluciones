import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { ArcaTicket } from "./models";
import { COMPANIES, type CompanyKey } from "./companies";
import { HttpError } from "./api";

/*
 * Factura electrónica de ARCA (ex AFIP) por web services: WSAA para entrar y
 * WSFEv1 para los comprobantes.
 *
 * Cada empresa tiene en ARCA su certificado con el alias "pinosoluciones",
 * autorizado para "Facturación Electrónica". En el servidor van en
 * ARCA_CERT_DIR como <empresa>.crt y <empresa>.key (constructora.crt, tvp.key),
 * fuera del repo, que es público. Sin esos dos archivos la empresa no está
 * conectada. ARCA_ENV elige el ambiente: "produccion" (por defecto) u
 * "homologacion", el de prueba, que necesita certificados propios de ahí.
 */

export type ArcaEnvironment = "produccion" | "homologacion";

const URLS: Record<ArcaEnvironment, { wsaa: string; wsfe: string }> = {
  produccion: { wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms", wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx" },
  homologacion: { wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms", wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx" },
};

/** Los códigos de ARCA de los comprobantes que emiten las empresas (las dos son responsables inscriptas). */
export const ARCA_VOUCHER_CODES = [
  { code: 1, label: "Factura A" }, { code: 6, label: "Factura B" },
  { code: 3, label: "Nota de crédito A" }, { code: 8, label: "Nota de crédito B" },
] as const;

export function arcaEnvironment(): ArcaEnvironment {
  return process.env.ARCA_ENV?.trim() === "homologacion" ? "homologacion" : "produccion";
}

/** El certificado y la clave de la empresa, o null si todavía no se cargaron en el servidor. */
export function arcaCredentials(company: CompanyKey) {
  const dir = process.env.ARCA_CERT_DIR?.trim();
  if (!dir) return null;
  const cert = path.join(dir, `${company}.crt`);
  const key = path.join(dir, `${company}.key`);
  return existsSync(cert) && existsSync(key) ? { cert, key } : null;
}

function cuitOf(company: CompanyKey) {
  return COMPANIES[company].cuit.replace(/\D/g, "");
}

/** El contenido del primer <tag> (sin namespace), o "" si no está. */
export function xmlTag(xml: string, tag: string) {
  return xmlTags(xml, tag)[0] ?? "";
}

export function xmlTags(xml: string, tag: string) {
  const pattern = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "g");
  return [...xml.matchAll(pattern)].map(match => match[1]);
}

export function xmlUnescape(text: string) {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16))).replace(/&amp;/g, "&");
}

/** Los errores que devuelve WSFEv1 en <Errors>, como "600: ValidacionDeToken: ...". */
export function wsfeErrors(xml: string) {
  return xmlTags(xml, "Err").map(err => `${xmlTag(err, "Code")}: ${xmlUnescape(xmlTag(err, "Msg"))}`);
}

/** Firma el pedido de acceso con el certificado (CMS, como pide WSAA). Usa el openssl del sistema. */
function signRequest(xml: string, cert: string, key: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("openssl", ["cms", "-sign", "-signer", cert, "-inkey", key, "-nodetach", "-outform", "DER"]);
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(Buffer.concat(chunks).toString("base64")) : reject(new Error(`openssl no pudo firmar el pedido a ARCA: ${stderr.trim()}`)));
    child.stdin.end(xml);
  });
}

// El servidor de WSFEv1 ofrece primero Diffie-Hellman clásico con una clave de 1024 bits, que
// Node rechaza (ERR_SSL_DH_KEY_TOO_SMALL). Para ARCA se piden solo cifrados ECDHE con AES-GCM o
// ChaCha20, que el servidor también acepta: más estricto que lo de siempre, no menos.
const arcaAgent = new https.Agent({ keepAlive: true, ciphers: "ECDHE+AESGCM:ECDHE+CHACHA20" });

function post(url: string, body: string, soapAction: string) {
  return new Promise<string>((resolve, reject) => {
    const request = https.request(url, {
      method: "POST", agent: arcaAgent, timeout: 30_000,
      headers: { "content-type": "text/xml; charset=utf-8", soapaction: soapAction, "content-length": Buffer.byteLength(body) },
    }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new HttpError("ARCA no respondió a tiempo", 504)));
    request.on("error", error => reject(error instanceof HttpError ? error : new HttpError(`No se pudo conectar con ARCA: ${error.message}`, 502)));
    request.end(body);
  });
}

/**
 * El ticket de acceso de la empresa para un servicio. Se guarda en la base y se
 * reusa hasta 5 minutos antes de que venza: ARCA no da uno nuevo mientras el
 * anterior siga vigente.
 */
export async function arcaLogin(company: CompanyKey, service = "wsfe") {
  const credentials = arcaCredentials(company);
  if (!credentials) throw new HttpError(`${COMPANIES[company].short} no tiene cargado en el servidor el certificado de ARCA`);
  const environment = arcaEnvironment();
  const id = `${environment}:${cuitOf(company)}:${service}`;
  const saved = await ArcaTicket.findById(id).lean<{ token: string; sign: string; expiresAt: Date }>();
  if (saved && saved.expiresAt.getTime() - Date.now() > 5 * 60_000) return saved;

  const now = Date.now();
  const iso = (time: number) => new Date(time).toISOString().replace(/\.\d+Z$/, "+00:00");
  const request = `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${Math.floor(now / 1000)}</uniqueId><generationTime>${iso(now - 10 * 60_000)}</generationTime><expirationTime>${iso(now + 10 * 60_000)}</expirationTime></header><service>${service}</service></loginTicketRequest>`;
  const cms = await signRequest(request, credentials.cert, credentials.key);
  const response = await post(URLS[environment].wsaa,
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`, "\"\"");
  const ticket = xmlUnescape(xmlTag(response, "loginCmsReturn"));
  if (!ticket) {
    const fault = xmlUnescape(xmlTag(response, "faultstring")) || "ARCA no respondió";
    throw new HttpError(/TA valido/i.test(fault)
      ? "ARCA ya entregó un ticket de acceso que este servidor no tiene guardado; no da otro hasta que venza (hasta 12 horas)"
      : `ARCA rechazó el ingreso: ${fault}`, 502);
  }
  const result = { token: xmlTag(ticket, "token"), sign: xmlTag(ticket, "sign"), expiresAt: new Date(xmlTag(ticket, "expirationTime")) };
  await ArcaTicket.updateOne({ _id: id }, { $set: result }, { upsert: true });
  return result;
}

/** Llama a un método de WSFEv1 con la autenticación de la empresa y devuelve la respuesta (XML). `ignore`: códigos de error que no lo son (602, sin resultados). */
async function wsfe(company: CompanyKey, method: string, body = "", ignore: string[] = []) {
  const { token, sign } = await arcaLogin(company);
  const auth = `<ar:Auth><ar:Token>${token}</ar:Token><ar:Sign>${sign}</ar:Sign><ar:Cuit>${cuitOf(company)}</ar:Cuit></ar:Auth>`;
  const response = await post(URLS[arcaEnvironment()].wsfe,
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Body><ar:${method}>${auth}${body}</ar:${method}></soapenv:Body></soapenv:Envelope>`,
    `"http://ar.gov.afip.dif.FEV1/${method}"`);
  const errors = wsfeErrors(response).filter(error => !ignore.includes(error.split(":")[0]));
  if (errors.length) throw new HttpError(`ARCA: ${errors.join(" · ")}`, 502);
  if (!response.includes(`${method}Result`)) throw new HttpError(`ARCA no respondió ${method}: ${xmlUnescape(xmlTag(response, "faultstring")) || "respuesta vacía"}`, 502);
  return response;
}

/** Los puntos de venta de web services que la empresa tiene dados de alta en ARCA. */
export async function arcaPointsOfSale(company: CompanyKey) {
  const response = await wsfe(company, "FEParamGetPtosVenta", "", ["602"]);
  return xmlTags(response, "PtoVenta").map(item => ({
    number: Number(xmlTag(item, "Nro")),
    type: xmlTag(item, "EmisionTipo"),
    blocked: xmlTag(item, "Bloqueado") === "S",
    closed: !["", "NULL"].includes(xmlTag(item, "FchBaja")),
  }));
}

/** El último número que ARCA autorizó en ese punto de venta para ese tipo de comprobante (0 si nunca se usó). */
export async function arcaLastNumber(company: CompanyKey, pointOfSale: number, voucherCode: number) {
  const response = await wsfe(company, "FECompUltimoAutorizado", `<ar:PtoVta>${pointOfSale}</ar:PtoVta><ar:CbteTipo>${voucherCode}</ar:CbteTipo>`);
  return Number(xmlTag(response, "CbteNro") || 0);
}

export type ArcaStatus = {
  company: CompanyKey; cuit: string; environment: ArcaEnvironment; configured: boolean;
  ok?: boolean; error?: string; ticketExpiresAt?: string;
  pointsOfSale?: Array<{ number: number; type: string; blocked: boolean; closed: boolean; last: Array<{ code: number; label: string; number: number }> }>;
};

/**
 * Prueba la conexión de la empresa sin emitir nada: entra a ARCA, trae sus
 * puntos de venta de web services y el último número de cada comprobante en cada uno.
 */
export async function arcaStatus(company: CompanyKey): Promise<ArcaStatus> {
  const base = { company, cuit: COMPANIES[company].cuit, environment: arcaEnvironment(), configured: Boolean(arcaCredentials(company)) };
  if (!base.configured) return base;
  try {
    const ticket = await arcaLogin(company);
    const points = await arcaPointsOfSale(company);
    const pointsOfSale = await Promise.all(points.map(async point => ({
      ...point,
      last: await Promise.all(ARCA_VOUCHER_CODES.map(async voucher => ({ ...voucher, number: await arcaLastNumber(company, point.number, voucher.code) }))),
    })));
    return { ...base, ok: true, ticketExpiresAt: new Date(ticket.expiresAt).toISOString(), pointsOfSale };
  } catch (error) {
    return { ...base, ok: false, error: error instanceof Error ? error.message : "No se pudo conectar con ARCA" };
  }
}
