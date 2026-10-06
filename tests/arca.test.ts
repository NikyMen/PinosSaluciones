import { describe, expect, it } from "vitest";
import { wsfeErrors, xmlTag, xmlTags, xmlUnescape } from "../src/lib/arca";

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
