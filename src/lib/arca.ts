import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { ArcaTicket } from "./models";
import { COMPANIES, type CompanyKey } from "./companies";
import { HttpError } from "./api";
import { ARCA_VOUCHER_CODE, VAT_CONDITIONS, type ArcaVoucherType, type VatCondition } from "./fiscal";
import { formatVoucherNumber, voucherLabels } from "./invoice-labels";
import { voucherBooks } from "./voucher-books";

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
  { code: 1, label: "Factura A" }, { code: 2, label: "Nota de Débito A" }, { code: 3, label: "Nota de Crédito A" },
  { code: 6, label: "Factura B" }, { code: 7, label: "Nota de Débito B" }, { code: 8, label: "Nota de Crédito B" },
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

/**
 * El número que sigue en ARCA para ese comprobante de la empresa, en el punto de
 * venta por el que se emite. Sirve para mostrarlo antes de emitir.
 */
export async function arcaNextNumber(company: CompanyKey, voucherType: ArcaVoucherType) {
  const enabled = (await arcaPointsOfSale(company)).filter(point => !point.blocked && !point.closed).map(point => point.number);
  const baseType = voucherType.endsWith("_b") ? "factura_b" : "factura_a";
  const book = await arcaBookFor(company, baseType, enabled);
  if (!book) throw new HttpError(`${COMPANIES[company].short} no tiene un talonario de ${voucherLabels[baseType]} en un punto de venta de web services de ARCA (${enabled.map(number => String(number).padStart(4, "0")).join(", ") || "ninguno"}). Se agrega en Configuración > Empresas y comprobantes.`);
  const last = await arcaLastNumber(company, Number(book.pointOfSale), ARCA_VOUCHER_CODE[voucherType]);
  return { pointOfSale: book.pointOfSale, last, next: formatVoucherNumber(book.pointOfSale, last + 1) };
}

/** El último número que ARCA autorizó en ese punto de venta para ese tipo de comprobante (0 si nunca se usó). */
export async function arcaLastNumber(company: CompanyKey, pointOfSale: number, voucherCode: number) {
  const response = await wsfe(company, "FECompUltimoAutorizado", `<ar:PtoVta>${pointOfSale}</ar:PtoVta><ar:CbteTipo>${voucherCode}</ar:CbteTipo>`);
  return Number(xmlTag(response, "CbteNro") || 0);
}

/**
 * El talonario por el que se emite: el habilitado de esa empresa y ese tipo cuyo
 * punto de venta ARCA tiene de alta para web services. El 0001 que se crea solo
 * no lo es, así que nunca se emite por error en un punto de venta que no corresponde.
 */
export async function arcaBookFor(company: CompanyKey, voucherType: "factura_a" | "factura_b", enabledPoints: number[]) {
  const books = await voucherBooks({ company, scope: "venta", voucherType, active: true });
  return books.find(book => enabledPoints.includes(Number(book.pointOfSale))) || null;
}

export type ArcaStatus = {
  company: CompanyKey; cuit: string; environment: ArcaEnvironment; configured: boolean;
  ok?: boolean; error?: string; ticketExpiresAt?: string;
  pointsOfSale?: Array<{ number: number; type: string; blocked: boolean; closed: boolean; last: Array<{ code: number; label: string; number: number }> }>;
  /** El punto de venta por el que se emite cada tipo, o null si falta el talonario. */
  emitsFrom?: { factura_a: string | null; factura_b: string | null };
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
    const enabled = points.filter(point => !point.blocked && !point.closed).map(point => point.number);
    const [bookA, bookB] = await Promise.all([arcaBookFor(company, "factura_a", enabled), arcaBookFor(company, "factura_b", enabled)]);
    return { ...base, ok: true, ticketExpiresAt: new Date(ticket.expiresAt).toISOString(), pointsOfSale, emitsFrom: { factura_a: bookA?.pointOfSale || null, factura_b: bookB?.pointOfSale || null } };
  } catch (error) {
    return { ...base, ok: false, error: error instanceof Error ? error.message : "No se pudo conectar con ARCA" };
  }
}

/*
 * Emisión con CAE (FECAESolicitar). ARCA autoriza el comprobante y le da el
 * número: el que sigue al último autorizado en ese punto de venta y tipo.
 */

/** A un responsable inscripto o monotributista se le hace A (y sus notas); al resto, B. */
const RECEIVERS_BY_LETTER: Record<"a" | "b", VatCondition[]> = {
  a: ["responsable_inscripto", "monotributo"],
  b: ["exento", "consumidor_final", "no_alcanzado"],
};

/** El código de ARCA de cada alícuota de IVA. */
const VAT_RATE_IDS: Record<string, number> = { "0": 3, "2.5": 9, "5": 8, "10.5": 4, "21": 5, "27": 6 };

export type CaeRequest = {
  voucherType: ArcaVoucherType; pointOfSale: number; number: number;
  /** Una nota de débito o de crédito: la factura a la que corresponde (ARCA la pide). */
  associated?: { voucherCode: number; pointOfSale: number; number: number; cuit: string; date: Date };
  /** 1 productos (se factura un remito), 2 servicios (obra, certificado). */
  concept: 1 | 2;
  clientCuit: string; vatCondition: VatCondition;
  issueDate: Date; dueDate?: Date;
  netCents: number; vatPct: number; vatCents: number; amountCents: number;
};

/** "20261006" a partir de una fecha del formulario (que llega como medianoche UTC). */
export function arcaDate(value: Date) {
  return value.toISOString().slice(0, 10).replace(/-/g, "");
}

const pesos = (cents: number) => (cents / 100).toFixed(2);

/** Revisa que la factura se pueda emitir y arma el detalle de FECAESolicitar. */
export function buildCaeRequest(request: CaeRequest) {
  const { voucherType, vatCondition } = request;
  const letter = voucherType.endsWith("_b") ? "b" : "a";
  if (!RECEIVERS_BY_LETTER[letter].includes(vatCondition)) {
    throw new HttpError(`A un cliente ${VAT_CONDITIONS[vatCondition].label} no se le hace ${voucherLabels[voucherType]}: corresponde la letra ${letter === "a" ? "B" : "A"}`);
  }
  const isNote = voucherType.startsWith("nota_");
  if (isNote && !request.associated) throw new HttpError(`La ${voucherLabels[voucherType]} va asociada a una factura`);
  const cuit = request.clientCuit.replace(/\D/g, "");
  if (cuit.length !== 11) throw new HttpError("El cliente no tiene un CUIT válido cargado: ARCA lo pide para emitir");
  if (request.netCents <= 0) throw new HttpError("Para emitir en ARCA cargá el neto gravado de la factura");
  const rateId = VAT_RATE_IDS[String(request.vatPct)];
  if (rateId === undefined) throw new HttpError(`ARCA no tiene la alícuota de IVA ${request.vatPct} %`);
  if (request.netCents + request.vatCents !== request.amountCents) throw new HttpError("El total no es el neto más el IVA: revisá los importes");

  // En servicios ARCA pide el período facturado y el vencimiento del pago: el mes de la factura.
  const issue = request.issueDate;
  const service = request.concept === 2 ? (() => {
    const from = new Date(Date.UTC(issue.getUTCFullYear(), issue.getUTCMonth(), 1));
    const to = new Date(Date.UTC(issue.getUTCFullYear(), issue.getUTCMonth() + 1, 0));
    const due = request.dueDate && request.dueDate > issue ? request.dueDate : issue;
    return `<ar:FchServDesde>${arcaDate(from)}</ar:FchServDesde><ar:FchServHasta>${arcaDate(to)}</ar:FchServHasta><ar:FchVtoPago>${arcaDate(due)}</ar:FchVtoPago>`;
  })() : "";

  return `<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${request.pointOfSale}</ar:PtoVta><ar:CbteTipo>${ARCA_VOUCHER_CODE[voucherType]}</ar:CbteTipo></ar:FeCabReq>`
    + `<ar:FeDetReq><ar:FECAEDetRequest><ar:Concepto>${request.concept}</ar:Concepto><ar:DocTipo>80</ar:DocTipo><ar:DocNro>${cuit}</ar:DocNro>`
    + `<ar:CbteDesde>${request.number}</ar:CbteDesde><ar:CbteHasta>${request.number}</ar:CbteHasta><ar:CbteFch>${arcaDate(issue)}</ar:CbteFch>`
    + `<ar:ImpTotal>${pesos(request.amountCents)}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc><ar:ImpNeto>${pesos(request.netCents)}</ar:ImpNeto><ar:ImpOpEx>0.00</ar:ImpOpEx><ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>${pesos(request.vatCents)}</ar:ImpIVA>`
    + `${service}<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>${VAT_CONDITIONS[vatCondition].id}</ar:CondicionIVAReceptorId>`
    + (isNote && request.associated ? `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${request.associated.voucherCode}</ar:Tipo><ar:PtoVta>${request.associated.pointOfSale}</ar:PtoVta><ar:Nro>${request.associated.number}</ar:Nro><ar:Cuit>${request.associated.cuit.replace(/\D/g, "")}</ar:Cuit><ar:CbteFch>${arcaDate(request.associated.date)}</ar:CbteFch></ar:CbteAsoc></ar:CbtesAsoc>` : "")
    + `<ar:Iva><ar:AlicIva><ar:Id>${rateId}</ar:Id><ar:BaseImp>${pesos(request.netCents)}</ar:BaseImp><ar:Importe>${pesos(request.vatCents)}</ar:Importe></ar:AlicIva></ar:Iva>`
    + `</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`;
}

/** El CAE y su vencimiento, o el motivo del rechazo, de la respuesta de FECAESolicitar. */
export function readCaeResponse(xml: string) {
  const detail = xmlTag(xml, "FECAEDetResponse");
  const result = xmlTag(detail, "Resultado") || xmlTag(xml, "Resultado");
  const observations = xmlTags(detail, "Obs").map(obs => `${xmlTag(obs, "Code")}: ${xmlUnescape(xmlTag(obs, "Msg"))}`);
  const cae = xmlTag(detail, "CAE");
  const due = xmlTag(detail, "CAEFchVto");
  if (result !== "A" || !/^\d{14}$/.test(cae)) throw new HttpError(`ARCA rechazó la factura${observations.length ? `: ${observations.join(" · ")}` : ""}`, 422);
  return { cae, caeDueDate: new Date(Date.UTC(Number(due.slice(0, 4)), Number(due.slice(4, 6)) - 1, Number(due.slice(6, 8)))), observations };
}

// Una emisión por vez en cada punto de venta y tipo: el número es el último + 1.
const emitting = new Map<string, Promise<unknown>>();

/**
 * Emite la factura en ARCA: toma el número que sigue en el punto de venta y
 * pide el CAE. Devuelve el número que asignó ARCA y el CAE. Si ARCA la
 * rechaza, no queda nada emitido.
 */
export async function arcaEmitInvoice(company: CompanyKey, { expectedNumber, ...request }: Omit<CaeRequest, "number"> & { expectedNumber?: number }) {
  const key = `${company}:${request.pointOfSale}:${request.voucherType}`;
  const run = (emitting.get(key) || Promise.resolve()).catch(() => undefined).then(async () => {
    const number = await arcaLastNumber(company, request.pointOfSale, ARCA_VOUCHER_CODE[request.voucherType]) + 1;
    if (expectedNumber && expectedNumber !== number) throw new HttpError(`El número que sigue en ARCA es el ${formatVoucherNumber(String(request.pointOfSale), number)}, no el ${formatVoucherNumber(String(request.pointOfSale), expectedNumber)}: alguien emitió otro mientras tanto. Revisalo y guardá de nuevo.`, 409);
    const body = buildCaeRequest({ ...request, number });
    const response = await wsfe(company, "FECAESolicitar", body);
    return { number, ...readCaeResponse(response) };
  });
  emitting.set(key, run);
  try { return await run; } finally { if (emitting.get(key) === run) emitting.delete(key); }
}
