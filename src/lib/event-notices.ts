import { notify } from "./notifications";
import { money } from "./format";
import type { Session } from "./auth";

/*
 * Los avisos por hitos del negocio (requerimiento integral v4, punto 6): cada
 * área recibe su propio aviso, con lo que tiene que hacer, y lo resuelve en su
 * bandeja sin depender de las otras.
 */

type Doc = Record<string, unknown> & { _id: unknown };

/** Cotización aprobada: Compras prepara el abastecimiento, Producción planifica y Administración revisa el anticipo. */
export async function noticeQuoteApproved(quote: Doc, session: Session) {
  const label = `${String(quote.number || "")} — ${String(quote.title || "")}`;
  const href = `/app/quotes/${String(quote._id)}`;
  const common = { kind: "cotizacion" as const, href };
  await notify({ ...common, title: `Cotización aprobada ${label}: reserva y faltantes`, body: `La aprobó ${session.name}. Revisar la reserva de stock, los faltantes y el requerimiento de abastecimiento.`, roles: ["compras"], event: "cotizacion.aprobada.compras", dedupeKey: `quote-approved-${String(quote._id)}-compras` });
  await notify({ ...common, title: `Cotización aprobada ${label}: planificar la obra`, body: "Planificar la obra y confirmar la fecha real de inicio.", roles: ["arquitecto"], event: "cotizacion.aprobada.produccion", dedupeKey: `quote-approved-${String(quote._id)}-produccion` });
  await notify({ ...common, title: `Cotización aprobada ${label}: anticipo y condiciones`, body: `Por ${money(Number(quote.amountCents || 0))}. Revisar el anticipo, el crédito y las condiciones financieras.`, roles: ["administracion"], event: "cotizacion.aprobada.administracion", dedupeKey: `quote-approved-${String(quote._id)}-administracion` });
}

/** Obra finalizada: Ventas, Administración, Compras y RR. HH. cierran cada uno lo suyo. */
export async function noticeWorkFinished(work: Doc, session: Session) {
  const label = `${String(work.code || "")} — ${String(work.name || "")}`;
  const href = `/app/works/${String(work._id)}`;
  const common = { kind: "obra" as const, href };
  const by = `La marcó finalizada ${session.name}.`;
  await notify({ ...common, title: `Obra finalizada ${label}: facturación y adicionales`, body: `${by} Revisar la facturación pendiente y los adicionales.`, roles: ["ventas"], event: "obra.finalizada.ventas", dedupeKey: `work-finished-${String(work._id)}-ventas` });
  await notify({ ...common, title: `Obra finalizada ${label}: cobranza y resultado`, body: `${by} Revisar la cobranza, el fondo de reparo y el resultado de la obra.`, roles: ["administracion"], event: "obra.finalizada.administracion", dedupeKey: `work-finished-${String(work._id)}-administracion` });
  await notify({ ...common, title: `Obra finalizada ${label}: cerrar el abastecimiento`, body: `${by} Cerrar el abastecimiento y recuperar materiales y equipos.`, roles: ["compras"], event: "obra.finalizada.compras", dedupeKey: `work-finished-${String(work._id)}-compras` });
  // RR. HH. lo lleva Administración.
  await notify({ ...common, title: `Obra finalizada ${label}: desafectar al personal`, body: `${by} Desafectar al personal y cerrar horas y novedades.`, roles: ["administracion"], event: "obra.finalizada.rrhh", dedupeKey: `work-finished-${String(work._id)}-rrhh` });
}
