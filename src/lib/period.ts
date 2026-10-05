import { COMPANY_KEYS, type CompanyKey } from "./companies";

/**
 * El período de un reporte: ?from=aaaa-mm-dd&to=aaaa-mm-dd&company=tvp. Sin
 * fechas es el mes en curso. `to` incluye el día entero.
 */
export function periodFrom(params: URLSearchParams): { from: Date; to: Date; company: CompanyKey | "" } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const valid = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
  const from = valid(params.get("from")) || first;
  const toDay = valid(params.get("to")) || new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const to = new Date(toDay.getTime() + 86_399_999);
  const company: CompanyKey | "" = COMPANY_KEYS.includes(params.get("company") as CompanyKey) ? params.get("company") as CompanyKey : "";
  return { from, to, company };
}
