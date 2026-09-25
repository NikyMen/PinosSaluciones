import "server-only";
import { connectDB } from "./db";
import { CalendarSettings, CalendarBooking } from "./models";

export type CalendarConfig = {
  enabled: boolean;
  calendarId: string;
  refreshToken: string | null;
  accessToken: string | null;
  tokenExpiry: Date | null;
  userEmail: string | null;
  meetingDurationMinutes: number;
  slotIntervalMinutes: number;
  bufferBetweenMeetings: number;
  workingDays: number[];
  workingHoursStart: string;
  workingHoursEnd: string;
  timezone: string;
  createMeetLink: boolean;
  defaultTitle: string;
  defaultDescription: string;
};

export type AvailableSlot = { time: string; startIso: string; endIso: string };

export type BookingRequest = {
  clientId?: string;
  contactName: string;
  contactPhone?: string;
  contactEmail?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  notes?: string;
  createdBy?: { id: string; name: string };
};

const DEFAULTS = {
  enabled: false,
  calendarId: "primary",
  refreshToken: null as string | null,
  accessToken: null as string | null,
  tokenExpiry: null as Date | null,
  userEmail: null as string | null,
  meetingDurationMinutes: 45,
  slotIntervalMinutes: 30,
  bufferBetweenMeetings: 15,
  workingDays: [1, 2, 3, 4, 5],
  workingHoursStart: "09:00",
  workingHoursEnd: "18:00",
  timezone: "America/Argentina/Buenos_Aires",
  createMeetLink: true,
  defaultTitle: "Reunión - {{name}}",
  defaultDescription: "Reunión agendada desde Pino Soluciones.\nContacto: {{name}}\nTeléfono: {{phone}}",
};

/** Config unica de la agenda. No existe hasta que gerencia guarda algo por primera vez. */
export async function getCalendarSettings(): Promise<CalendarConfig> {
  await connectDB();
  const row = await CalendarSettings.findById("main").lean();
  if (!row) return { ...DEFAULTS };
  return {
    enabled: !!row.enabled,
    calendarId: row.calendarId || DEFAULTS.calendarId,
    refreshToken: row.refreshToken || null,
    accessToken: row.accessToken || null,
    tokenExpiry: row.tokenExpiry || null,
    userEmail: row.userEmail || null,
    meetingDurationMinutes: row.meetingDurationMinutes || DEFAULTS.meetingDurationMinutes,
    slotIntervalMinutes: row.slotIntervalMinutes || DEFAULTS.slotIntervalMinutes,
    bufferBetweenMeetings: row.bufferBetweenMeetings ?? DEFAULTS.bufferBetweenMeetings,
    workingDays: row.workingDays?.length ? row.workingDays : DEFAULTS.workingDays,
    workingHoursStart: row.workingHoursStart || DEFAULTS.workingHoursStart,
    workingHoursEnd: row.workingHoursEnd || DEFAULTS.workingHoursEnd,
    timezone: row.timezone || DEFAULTS.timezone,
    createMeetLink: row.createMeetLink ?? true,
    defaultTitle: row.defaultTitle || DEFAULTS.defaultTitle,
    defaultDescription: row.defaultDescription || DEFAULTS.defaultDescription,
  };
}

export async function saveCalendarSettings(data: Partial<CalendarConfig>) {
  await connectDB();
  await CalendarSettings.findByIdAndUpdate("main", { _id: "main", ...data }, { upsert: true, setDefaultsOnInsert: true });
  return getCalendarSettings();
}

const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

function redirectUri() {
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/api/calendar/oauth/callback`;
}

/** Arma la URL de consentimiento de Google. Requiere GOOGLE_CALENDAR_CLIENT_ID en el .env. */
export function getGoogleOAuthUrl() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  if (!clientId) throw new Error("Falta GOOGLE_CALENDAR_CLIENT_ID en el .env");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

/** Canjea el code del callback por tokens y deja la cuenta conectada. */
export async function exchangeGoogleOAuthCode(code: string) {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("Faltan las credenciales de Google Calendar en el .env");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(), grant_type: "authorization_code" }),
  });
  if (!tokenRes.ok) throw new Error(`Error canjeando el código de Google: ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();

  let email: string | undefined;
  try {
    const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    if (userRes.ok) email = (await userRes.json()).email;
  } catch {
    // El email es solo informativo para la pantalla de conexión; no bloquea nada.
  }

  await saveCalendarSettings({
    refreshToken: tokenData.refresh_token,
    accessToken: tokenData.access_token,
    tokenExpiry: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
    userEmail: email || null,
    enabled: true,
  });
}

async function getValidAccessToken(settings: CalendarConfig): Promise<string> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  if (!settings.refreshToken || !clientId || !clientSecret) throw new Error("Google Calendar no está conectado.");

  const isExpired = !settings.accessToken || !settings.tokenExpiry || settings.tokenExpiry.getTime() - Date.now() < 120_000;
  if (!isExpired && settings.accessToken) return settings.accessToken;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: settings.refreshToken, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Error renovando el token de Google: ${await res.text()}`);
  const data = await res.json();
  const accessToken = data.access_token as string;
  await saveCalendarSettings({ accessToken, tokenExpiry: new Date(Date.now() + (data.expires_in || 3600) * 1000) });
  return accessToken;
}

export function isoDayOf(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay(); // 0=domingo
  return jsDay === 0 ? 7 : jsDay;
}

export type SlotRules = {
  workingHoursStart: string;
  workingHoursEnd: string;
  slotIntervalMinutes: number;
  bufferBetweenMeetings: number;
};

/**
 * El calculo de horarios en si: puro, sin red ni base. Recibe `now` y `busy` de
 * afuera para poder testearlo sin depender del reloj real ni de Google.
 */
export function computeDaySlots(params: { date: string; duration: number; rules: SlotRules; busy?: { start: number; end: number }[]; now?: number }): AvailableSlot[] {
  const { date, duration, rules, busy = [], now = Date.now() } = params;
  const [startH, startM] = rules.workingHoursStart.split(":").map(Number);
  const [endH, endM] = rules.workingHoursEnd.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const bufferMs = rules.bufferBetweenMeetings * 60 * 1000;

  const slots: AvailableSlot[] = [];
  for (let minutes = startMinutes; minutes + duration <= endMinutes; minutes += rules.slotIntervalMinutes) {
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const endTotal = minutes + duration;
    const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
    const startIso = `${date}T${time}:00`;
    const endIso = `${date}T${endTime}:00`;
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();

    if (startMs < now + 15 * 60 * 1000) continue; // no ofrecer horarios ya pasados o a menos de 15 min
    const overlaps = busy.some(b => startMs < b.end + bufferMs && endMs > b.start - bufferMs);
    if (!overlaps) slots.push({ time, startIso, endIso });
  }
  return slots;
}

/** Horarios libres para un dia (YYYY-MM-DD), contra las reglas configuradas y el FreeBusy real si hay cuenta conectada. */
export async function getAvailableSlots(params: { date: string; durationMinutes?: number }) {
  const settings = await getCalendarSettings();
  const isoDay = isoDayOf(params.date);

  if (!settings.workingDays.includes(isoDay)) {
    return { date: params.date, timezone: settings.timezone, isWorkingDay: false, slots: [] as AvailableSlot[] };
  }

  const duration = params.durationMinutes || settings.meetingDurationMinutes;

  let busy: { start: number; end: number }[] = [];
  if (settings.enabled && settings.refreshToken) {
    try {
      const token = await getValidAccessToken(settings);
      const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          timeMin: new Date(`${params.date}T00:00:00Z`).toISOString(),
          timeMax: new Date(`${params.date}T23:59:59Z`).toISOString(),
          timeZone: settings.timezone,
          items: [{ id: settings.calendarId }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        busy = (data.calendars?.[settings.calendarId]?.busy || []).map((b: { start: string; end: string }) => ({
          start: new Date(b.start).getTime(),
          end: new Date(b.end).getTime(),
        }));
      }
    } catch (error) {
      console.warn("No se pudo consultar la disponibilidad real de Google Calendar, se usa la base configurada:", error);
    }
  }

  const slots = computeDaySlots({ date: params.date, duration, rules: settings, busy });
  return { date: params.date, timezone: settings.timezone, isWorkingDay: true, slots };
}

function applyTemplate(template: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce((text, [key, value]) => text.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), value || ""), template);
}

/** Agenda el turno: crea el evento en Google (con Meet si corresponde) y lo guarda en Mongo. */
export async function createBooking(request: BookingRequest) {
  const settings = await getCalendarSettings();
  const duration = settings.meetingDurationMinutes;
  const [hour, minute] = request.time.split(":").map(Number);
  const startIso = `${request.date}T${request.time}:00`;
  const endTotal = hour * 60 + minute + duration;
  const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
  const endIso = `${request.date}T${endTime}:00`;

  const vars = { name: request.contactName, phone: request.contactPhone || "", email: request.contactEmail || "", notes: request.notes || "" };
  const summary = applyTemplate(settings.defaultTitle, vars);
  let description = applyTemplate(settings.defaultDescription, vars);
  if (request.notes) description += `\n\nNotas: ${request.notes}`;

  let eventId: string | undefined;
  let meetUrl: string | undefined;

  if (settings.enabled && settings.refreshToken) {
    const token = await getValidAccessToken(settings);
    const payload: Record<string, unknown> = {
      summary,
      description,
      start: { dateTime: new Date(startIso).toISOString(), timeZone: settings.timezone },
      end: { dateTime: new Date(endIso).toISOString(), timeZone: settings.timezone },
      reminders: { useDefault: false, overrides: [{ method: "email", minutes: 1440 }, { method: "popup", minutes: 30 }] },
    };
    if (request.contactEmail) payload.attendees = [{ email: request.contactEmail, displayName: request.contactName }];
    if (settings.createMeetLink) {
      payload.conferenceData = { createRequest: { requestId: `pinos-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(settings.calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
      { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    );
    if (!res.ok) throw new Error(`No se pudo crear el evento en Google Calendar: ${await res.text()}`);
    const event = await res.json();
    eventId = event.id;
    meetUrl = event.hangoutLink || event.conferenceData?.entryPoints?.find((ep: { entryPointType: string }) => ep.entryPointType === "video")?.uri;
  }

  await connectDB();
  const booking = await CalendarBooking.create({
    eventId,
    clientId: request.clientId || undefined,
    contactName: request.contactName,
    contactPhone: request.contactPhone,
    contactEmail: request.contactEmail,
    summary, description, meetUrl,
    startAt: new Date(startIso), endAt: new Date(endIso),
    status: "confirmado",
    createdBy: request.createdBy?.id,
    createdByName: request.createdBy?.name,
  });

  return booking.toObject();
}

export async function listBookings(limit = 50) {
  await connectDB();
  return CalendarBooking.find({ status: { $ne: "cancelado" } }).sort({ startAt: 1 }).limit(limit).lean();
}

/** Cancela el turno: borra el evento de Google si existe y lo marca cancelado en Mongo (no lo borra, para el historial). */
export async function cancelBooking(id: string) {
  await connectDB();
  const booking = await CalendarBooking.findById(id);
  if (!booking) throw new Error("Turno no encontrado");

  if (booking.eventId) {
    const settings = await getCalendarSettings();
    if (settings.enabled && settings.refreshToken) {
      try {
        const token = await getValidAccessToken(settings);
        await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(settings.calendarId)}/events/${booking.eventId}?sendUpdates=all`,
          { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
        );
      } catch (error) {
        console.warn("No se pudo borrar el evento en Google Calendar:", error);
      }
    }
  }

  booking.status = "cancelado";
  await booking.save();
  return booking.toObject();
}

export async function testConnection() {
  const settings = await getCalendarSettings();
  if (!settings.refreshToken) return { ok: false as const, error: "No hay una cuenta de Google conectada." };

  try {
    const token = await getValidAccessToken(settings);
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(settings.calendarId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false as const, error: `Error consultando el calendario: ${await res.text()}` };
    const data = await res.json();
    return { ok: true as const, email: settings.userEmail || undefined, calendarName: data.summary || "Calendario principal" };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function disconnect() {
  await saveCalendarSettings({ enabled: false, refreshToken: null, accessToken: null, tokenExpiry: null, userEmail: null });
}

export type CalendarEvent = {
  id: string; title: string; start: string; end: string; allDay: boolean;
  source: "pino" | "google"; meetUrl?: string; link?: string; contactName?: string; bookingId?: string;
};

/**
 * Lo que se ve en el calendario entre dos fechas: los turnos cargados en Pino y,
 * si hay una cuenta de Google conectada, también los eventos de ese calendario.
 * Un turno que ya está en Google no se muestra dos veces. Si Google no responde,
 * se muestran igual los turnos de Pino y se avisa.
 */
export async function listCalendarEvents(from: Date, to: Date) {
  await connectDB();
  const bookings = await CalendarBooking.find({ status: { $ne: "cancelado" }, startAt: { $gte: from, $lt: to } }).sort({ startAt: 1 }).lean() as Array<{
    _id: unknown; eventId?: string; summary?: string; contactName: string; startAt: Date; endAt: Date; meetUrl?: string;
  }>;
  const events: CalendarEvent[] = bookings.map(booking => ({
    id: `pino-${String(booking._id)}`, bookingId: String(booking._id), title: booking.summary || `Reunión - ${booking.contactName}`,
    start: new Date(booking.startAt).toISOString(), end: new Date(booking.endAt).toISOString(), allDay: false,
    source: "pino", meetUrl: booking.meetUrl, contactName: booking.contactName,
  }));

  const settings = await getCalendarSettings();
  let googleError = "";
  if (settings.enabled && settings.refreshToken) {
    try {
      const token = await getValidAccessToken(settings);
      const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(settings.calendarId)}/events`);
      url.searchParams.set("timeMin", from.toISOString());
      url.searchParams.set("timeMax", to.toISOString());
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("orderBy", "startTime");
      url.searchParams.set("maxResults", "250");
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { items?: Array<{ id: string; status?: string; summary?: string; htmlLink?: string; hangoutLink?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }> };
      const fromPino = new Set(bookings.map(booking => booking.eventId).filter(Boolean));
      for (const item of data.items || []) {
        if (item.status === "cancelled" || fromPino.has(item.id)) continue;
        const allDay = !item.start?.dateTime;
        // Un evento de día entero trae "2026-09-25": se lo ubica al mediodía para que no se corra de día por el huso.
        const start = item.start?.dateTime || `${item.start?.date}T12:00:00.000Z`;
        const end = item.end?.dateTime || `${item.end?.date}T12:00:00.000Z`;
        events.push({ id: `google-${item.id}`, title: item.summary || "(Sin título)", start: new Date(start).toISOString(), end: new Date(end).toISOString(), allDay, source: "google", meetUrl: item.hangoutLink, link: item.htmlLink });
      }
    } catch (error) {
      console.warn("No se pudieron leer los eventos de Google Calendar:", error);
      googleError = "No se pudieron leer los eventos de Google Calendar: se muestran sólo los turnos cargados en Pino.";
    }
  }
  events.sort((a, b) => a.start.localeCompare(b.start));
  return { events, google: { connected: Boolean(settings.enabled && settings.refreshToken), email: settings.userEmail || null, error: googleError } };
}
