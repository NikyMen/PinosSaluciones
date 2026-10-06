import { describe, expect, it } from "vitest";
import { buildCaeRequest, readCaeResponse, wsfeErrors, xmlTag, xmlTags, xmlUnescape, type CaeRequest } from "../src/lib/arca";
import { arcaQrUrl, vatConditionFor } from "../src/lib/fiscal";
import { checkFiscalChanges } from "../src/lib/invoice-service";

/** Respuestas reales de ARCA (WSAA y WSFEv1), recortadas. */
describe("lectura de las respuestas de ARCA", () => {
  it("saca el ticket de acceso de la respuesta de WSAA, que viene escapado", () => {
    const response = `<soapenv:Envelope><soapenv:Body><loginCmsResponse><loginCmsReturn>&lt;?xml version="1.0"?&gt;&lt;loginTicketResponse&gt;&lt;header&gt;&lt;expirationTime&gt;2026-10-06T21:36:45.845-03:00&lt;/expirationTime&gt;&lt;/header&gt;&lt;credentials&gt;&lt;token&gt;PD94bWw=&lt;/token&gt;&lt;sign&gt;abc+/=&lt;/sign&gt;&lt;/credentials&gt;&lt;/loginTicketResponse&gt;</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`;
    const ticket = xmlUnescape(xmlTag(response, "loginCmsReturn"));
    expect(xmlTag(ticket, "token")).toBe("PD94bWw=");
    expect(xmlTag(ticket, "sign")).toBe("abc+/=");
    expect(new Date(xmlTag(ticket, "expirationTime")).toISOString()).toBe("2026-10-07T00:36:45.845Z");
  });

  it("lee los puntos de venta y no confunde los avisos (Events) con errores", () => {
    const response = `<FEParamGetPtosVentaResult><ResultGet><PtoVenta><Nro>2</Nro><EmisionTipo>CAE - Ri Iva</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja>NULL</FchBaja></PtoVenta><PtoVenta><Nro>3</Nro><EmisionTipo>CAE - Ri Iva</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja>NULL</FchBaja></PtoVenta></ResultGet><Events><Evt><Code>39</Code><Msg>IMPORTANTE: aviso</Msg></Evt></Events></FEParamGetPtosVentaResult>`;
    expect(xmlTags(response, "PtoVenta").map(item => xmlTag(item, "Nro"))).toEqual(["2", "3"]);
    expect(wsfeErrors(response)).toEqual([]);
  });

  it("junta los errores de WSFEv1", () => {
    const response = `<FECompUltimoAutorizadoResult><Errors><Err><Code>600</Code><Msg>ValidacionDeToken: No aparecio CUIT en lista de relaciones</Msg></Err></Errors></FECompUltimoAutorizadoResult>`;
    expect(wsfeErrors(response)).toEqual(["600: ValidacionDeToken: No aparecio CUIT en lista de relaciones"]);
  });

  it("decodifica acentos escapados", () => {
    expect(xmlUnescape("inv&#xE1;lido &amp; m&#xE1;s")).toBe("inválido & más");
  });
});

describe("emisión con CAE", () => {
  const factura: CaeRequest = {
    voucherType: "factura_a", pointOfSale: 3, number: 1, concept: 2, clientCuit: "30-71629563-6", vatCondition: "responsable_inscripto",
    issueDate: new Date("2026-10-06"), dueDate: new Date("2026-10-21"), netCents: 115_000_000, vatPct: 21, vatCents: 24_150_000, amountCents: 139_150_000,
  };

  it("arma el pedido de una Factura A de servicios con el período del mes y el IVA al 21%", () => {
    const xml = buildCaeRequest(factura);
    expect(xmlTag(xml, "PtoVta")).toBe("3");
    expect(xmlTag(xml, "CbteTipo")).toBe("1");
    expect(xmlTag(xml, "DocNro")).toBe("30716295636");
    expect(xmlTag(xml, "CbteFch")).toBe("20261006");
    expect([xmlTag(xml, "FchServDesde"), xmlTag(xml, "FchServHasta"), xmlTag(xml, "FchVtoPago")]).toEqual(["20261001", "20261031", "20261021"]);
    expect([xmlTag(xml, "ImpNeto"), xmlTag(xml, "ImpIVA"), xmlTag(xml, "ImpTotal")]).toEqual(["1150000.00", "241500.00", "1391500.00"]);
    expect(xmlTag(xml, "CondicionIVAReceptorId")).toBe("1");
    expect(xmlTag(xmlTag(xml, "AlicIva"), "Id")).toBe("5");
    // El orden importa: CondicionIVAReceptorId va después de la moneda y antes del IVA.
    expect(xml.indexOf("MonCotiz")).toBeLessThan(xml.indexOf("CondicionIVAReceptorId"));
    expect(xml.indexOf("CondicionIVAReceptorId")).toBeLessThan(xml.indexOf("<ar:Iva>"));
  });

  it("una venta de productos (remito) no lleva período de servicio", () => {
    expect(buildCaeRequest({ ...factura, concept: 1 })).not.toContain("FchServDesde");
  });

  it("no emite una A a un consumidor final, sin neto o con el total que no cierra", () => {
    expect(() => buildCaeRequest({ ...factura, vatCondition: "consumidor_final" })).toThrow(/corresponde Factura B/);
    expect(() => buildCaeRequest({ ...factura, voucherType: "factura_b" })).toThrow(/corresponde Factura A/);
    expect(() => buildCaeRequest({ ...factura, netCents: 0, vatCents: 0, amountCents: 0 })).toThrow(/neto/);
    expect(() => buildCaeRequest({ ...factura, amountCents: 1 })).toThrow(/total/);
    expect(() => buildCaeRequest({ ...factura, clientCuit: "123" })).toThrow(/CUIT/);
  });

  it("sin la condición cargada: A a responsable inscripto, B a consumidor final", () => {
    expect(vatConditionFor("factura_a", undefined)).toBe("responsable_inscripto");
    expect(vatConditionFor("factura_b", "")).toBe("consumidor_final");
    expect(vatConditionFor("factura_a", "monotributo")).toBe("monotributo");
  });

  it("lee el CAE aprobado y explica el rechazo", () => {
    const ok = "<FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>76412345678901</CAE><CAEFchVto>20261016</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult>";
    const result = readCaeResponse(ok);
    expect(result.cae).toBe("76412345678901");
    expect(result.caeDueDate.toISOString().slice(0, 10)).toBe("2026-10-16");
    const rejected = "<FECAESolicitarResult><FeCabResp><Resultado>R</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10242</Code><Msg>Condicion IVA receptor no valida</Msg></Obs></Observaciones><CAE></CAE></FECAEDetResponse></FeDetResp></FECAESolicitarResult>";
    expect(() => readCaeResponse(rejected)).toThrow("ARCA rechazó la factura: 10242: Condicion IVA receptor no valida");
  });

  it("arma el QR con los datos que pide ARCA", () => {
    const url = arcaQrUrl({ issueDate: "2026-10-06T00:00:00.000Z", companyCuit: "30-71758997-8", pointOfSale: 3, voucherCode: 1, number: 1, amountCents: 139_150_000, clientCuit: "30-71629563-6", cae: "76412345678901" });
    expect(url.startsWith("https://www.afip.gob.ar/fe/qr/?p=")).toBe(true);
    expect(JSON.parse(atob(url.split("?p=")[1]))).toEqual({ ver: 1, fecha: "2026-10-06", cuit: 30717589978, ptoVta: 3, tipoCmp: 1, nroCmp: 1, importe: 1391500, moneda: "PES", ctz: 1, tipoDocRec: 80, nroDocRec: 30716295636, tipoCodAut: "E", codAut: 76412345678901 });
  });

  it("una factura con CAE no cambia lo fiscal ni se anula, pero sí la descripción", () => {
    const before = { cae: "76412345678901", number: "0003-00000001", amountCents: 100, issueDate: new Date("2026-10-06"), status: "pendiente" };
    expect(() => checkFiscalChanges(before, { amountCents: 200 })).toThrow(/nota de crédito/);
    expect(() => checkFiscalChanges(before, { status: "anulada" })).toThrow(/nota de crédito/);
    expect(() => checkFiscalChanges(before, { description: "otra", amountCents: 100, issueDate: new Date("2026-10-06") })).not.toThrow();
    expect(() => checkFiscalChanges({ number: "1" }, { amountCents: 200 })).not.toThrow();
  });
});
