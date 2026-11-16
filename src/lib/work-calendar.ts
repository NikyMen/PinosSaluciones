import { HttpError } from "./api";
import { HolidayCalendar } from "./models";
import { workEndForDays, workStartForDays } from "./business-days";

export type Holiday = { date: string; name: string };
export type Calendar = { year: number; holidays: Holiday[] };

const national2026: Holiday[] = [
  ["01-01", "Año Nuevo"], ["02-16", "Carnaval"], ["02-17", "Carnaval"], ["03-24", "Memoria, Verdad y Justicia"],
  ["04-02", "Veteranos y Caídos en Malvinas"], ["04-03", "Viernes Santo"], ["05-01", "Día del Trabajador"],
  ["05-25", "Revolución de Mayo"], ["06-15", "Paso a la Inmortalidad de Güemes"], ["06-20", "Paso a la Inmortalidad de Belgrano"],
  ["07-09", "Día de la Independencia"], ["08-17", "Paso a la Inmortalidad de San Martín"], ["10-12", "Respeto a la Diversidad Cultural"],
  ["11-09", "Visita del papa León XIV"], ["11-23", "Soberanía Nacional"], ["12-08", "Inmaculada Concepción"], ["12-25", "Navidad"],
].map(([day, name]) => ({ date: `2026-${day}`, name }));

export async function workCalendars(): Promise<Calendar[]> {
  const saved = await HolidayCalendar.find().select("year holidays").lean<Calendar[]>();
  const calendars = saved.some(calendar => calendar.year === 2026) ? saved : [...saved, { year: 2026, holidays: national2026 }];
  return calendars.sort((a, b) => a.year - b.year);
}

export async function workHolidays() {
  return new Set((await workCalendars()).flatMap(calendar => calendar.holidays.map(holiday => holiday.date)));
}

export async function applyWorkDuration(data: Record<string, unknown>, before: Record<string, unknown> = {}) {
  const days = data.durationBusinessDays;
  delete data.durationBusinessDays;
  if (!days) return;
  const start = "startDate" in data ? data.startDate : before.startDate;
  const end = "endDate" in data ? data.endDate : before.endDate;
  if (!start && !end) throw new HttpError("Cargá el inicio o el fin previsto para usar los días hábiles");
  const holidays = await workHolidays();
  if (start && ("startDate" in data || !("endDate" in data) || !end)) {
    data.endDate = new Date(workEndForDays(start as Date, Number(days), holidays));
  } else {
    data.startDate = new Date(workStartForDays(end as Date, Number(days), holidays));
  }
}
