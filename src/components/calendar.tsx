"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, ExternalLink, Loader2, Plus, Settings2, Trash2, Video, X } from "lucide-react";
import { todayIso } from "@/lib/format";
import { SearchSelect, type Option } from "@/components/fields";

/*
 * El calendario: el mes entero en una grilla de lunes a domingo, con los turnos
 * cargados en Pino y, si hay una cuenta conectada, los eventos de Google
 * Calendar. Tocar un día muestra lo que hay y deja agendar un turno.
 */

type CalendarEvent = {
  id: string; title: string; start: string; end: string; allDay: boolean;
  source: "pino" | "google"; meetUrl?: string; link?: string; contactName?: string; bookingId?: string;
};
type Google = { connected: boolean; email: string | null; error: string };

const TIMEZONE = "America/Argentina/Buenos_Aires";
const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** El día (aaaa-mm-dd) de un instante, en horario argentino. */
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(iso));
const timeOf = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const longDay = (day: string) => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));

/** Las semanas que muestra la grilla: de lunes a domingo, desde la que contiene el día 1 hasta la que contiene el último. */
function monthGrid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (first.getUTCDay() + 6) % 7; // lunes = 0
  const start = new Date(Date.UTC(year, month, 1 - offset));
  const last = new Date(Date.UTC(year, month + 1, 0));
  const weeks = Math.ceil((offset + last.getUTCDate()) / 7);
  return Array.from({ length: weeks * 7 }, (_, index) => {
    const day = new Date(start.getTime() + index * 86_400_000);
    return { iso: day.toISOString().slice(0, 10), inMonth: day.getUTCMonth() === month, number: day.getUTCDate() };
  });
}

function oauthQueryParam(key: string) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

export function CalendarView({ isManager }: { isManager: boolean }) {
  const today = todayIso();
  const [cursor, setCursor] = useState(() => { const [year, month] = today.split("-").map(Number); return { year, month: month - 1 }; });
  const [selected, setSelected] = useState(today);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [google, setGoogle] = useState<Google | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(() => oauthQueryParam("calendarError"));
  const [notice, setNotice] = useState<string | null>(() => (oauthQueryParam("calendarConnected") ? "Cuenta de Google conectada: ya se ven sus eventos en el calendario." : null));
  const [bookingDay, setBookingDay] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search) window.history.replaceState(null, "", "/app/calendario");
  }, []);

  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const from = grid[0].iso;
  const to = grid[grid.length - 1].iso;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/calendar/events?from=${from}&to=${to}`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "No se pudo cargar el calendario");
        setEvents(body.events || []); setGoogle(body.google || null);
      })
      .catch(problem => { if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : "No se pudo cargar el calendario"); });
    return () => controller.abort();
  }, [from, to, reload]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events || []) map.set(dayOf(event.start), [...(map.get(dayOf(event.start)) || []), event]);
    return map;
  }, [events]);

  function move(delta: number) {
    setCursor(current => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  }

  function goToday() {
    const [year, month] = today.split("-").map(Number);
    setCursor({ year, month: month - 1 });
    setSelected(today);
  }

  async function cancel(event: CalendarEvent) {
    if (!event.bookingId || !window.confirm(`¿Cancelar el turno "${event.title}"?`)) return;
    const response = await fetch(`/api/calendar/bookings/${event.bookingId}`, { method: "PATCH" });
    const body = await response.json();
    if (!response.ok) return setError(body.error || "No se pudo cancelar el turno.");
    setReload(value => value + 1);
  }

  const dayEvents = byDay.get(selected) || [];

  return <>
    <div className="page-heading"><div>
      <p className="eyebrow">GESTIÓN</p><h1>Calendario</h1>
      <p>Los turnos de Pino y, si está conectado, tu calendario de Google, en un mismo lugar.</p>
    </div>
      <div className="calendar-heading-actions">
        {isManager && <button type="button" className="secondary-btn" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /> Configuración</button>}
        <button type="button" className="primary-btn" onClick={() => setBookingDay(selected < today ? today : selected)}><Plus size={17} /> Agendar turno</button>
      </div>
    </div>

    {notice && <p className="notice success" role="status">{notice}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {google?.error && <p className="notice warning">{google.error}</p>}

    <div className="calendar-google">
      {google?.connected
        ? <span className="calendar-google-on"><span className="status-dot" /> Sincronizado con Google Calendar{google.email ? ` · ${google.email}` : ""}</span>
        : <span className="calendar-google-off">Sin conexión con Google Calendar{isManager ? "" : ": pedile a gerencia que la conecte"}.</span>}
      {!google?.connected && isManager && <a className="secondary-btn" href="/api/calendar/oauth/start"><ExternalLink size={15} /> Conectar Google</a>}
    </div>

    <div className="calendar-layout">
      <section className="panel calendar-month">
        <header className="calendar-toolbar">
          <button type="button" className="icon-btn" onClick={() => move(-1)} aria-label="Mes anterior"><ChevronLeft /></button>
          <h2>{MONTHS[cursor.month]} {cursor.year}</h2>
          <button type="button" className="icon-btn" onClick={() => move(1)} aria-label="Mes siguiente"><ChevronRight /></button>
          <button type="button" className="secondary-btn calendar-today" onClick={goToday}>Hoy</button>
          {events === null && <Loader2 size={16} className="spinning" aria-label="Cargando" />}
        </header>
        <div className="calendar-weekdays">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">{grid.map(day => {
          const list = byDay.get(day.iso) || [];
          const classes = ["calendar-day", day.inMonth ? "" : "other", day.iso === today ? "today" : "", day.iso === selected ? "selected" : ""].filter(Boolean).join(" ");
          return <button key={day.iso} type="button" className={classes} onClick={() => setSelected(day.iso)}
            aria-label={`${longDay(day.iso)}: ${list.length ? `${list.length} ${list.length === 1 ? "evento" : "eventos"}` : "sin eventos"}`} aria-pressed={day.iso === selected}>
            <span className="calendar-day-number">{day.number}</span>
            <span className="calendar-day-events">
              {list.slice(0, 3).map(event => <span key={event.id} className={`calendar-chip ${event.source}`}>{event.allDay ? "" : `${timeOf(event.start)} `}{event.title}</span>)}
              {list.length > 3 && <span className="calendar-more">+{list.length - 3} más</span>}
            </span>
            {list.length > 0 && <span className="calendar-dots" aria-hidden>{list.slice(0, 4).map(event => <i key={event.id} className={event.source} />)}</span>}
          </button>;
        })}</div>
        <footer className="calendar-legend"><span><i className="pino" /> Turnos de Pino</span><span><i className="google" /> Google Calendar</span></footer>
      </section>

      <section className="panel calendar-day-panel">
        <div className="panel-head"><div className="section-title"><CalendarDays /><div><h2>{longDay(selected)}</h2><p>{dayEvents.length ? `${dayEvents.length} ${dayEvents.length === 1 ? "evento" : "eventos"}` : "Sin eventos"}</p></div></div></div>
        <ul className="calendar-day-list">
          {dayEvents.map(event => <li key={event.id} className={event.source}>
            <span className="calendar-time">{event.allDay ? "Todo el día" : `${timeOf(event.start)} – ${timeOf(event.end)}`}</span>
            <b>{event.title}</b>
            <small>{event.source === "google" ? "Google Calendar" : "Turno de Pino"}{event.contactName ? ` · ${event.contactName}` : ""}</small>
            <span className="calendar-event-actions">
              {event.meetUrl && <a href={event.meetUrl} target="_blank" rel="noreferrer"><Video size={13} /> Meet</a>}
              {event.link && <a href={event.link} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Abrir en Google</a>}
              {event.bookingId && <button type="button" onClick={() => { void cancel(event); }}><Trash2 size={13} /> Cancelar</button>}
            </span>
          </li>)}
        </ul>
        {!dayEvents.length && <p className="calendar-empty">No hay nada agendado este día.</p>}
        {selected >= today && <button type="button" className="secondary-btn calendar-day-book" onClick={() => setBookingDay(selected)}><Plus size={15} /> Agendar un turno este día</button>}
      </section>
    </div>

    {bookingDay && <BookingModal day={bookingDay} onClose={() => setBookingDay(null)} onBooked={day => { setBookingDay(null); setSelected(day); setNotice("Turno agendado."); setReload(value => value + 1); }} />}
    {settingsOpen && <div className="modal-layer">
      <button className="modal-backdrop" onClick={() => setSettingsOpen(false)} aria-label="Cerrar" />
      <section className="modal calendar-settings-modal" role="dialog" aria-modal="true" aria-label="Configuración de Google Calendar">
        <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Settings2 /></span><div><p className="eyebrow">CALENDARIO</p><h2>Configuración</h2><small>Conexión con Google y horarios de los turnos</small></div></div>
          <button className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Cerrar"><X /></button></header>
        <CalendarSettingsPanel onChanged={() => setReload(value => value + 1)} />
      </section>
    </div>}
  </>;
}

type Slot = { time: string; startIso: string; endIso: string };

/** Agendar un turno: el día ya viene elegido desde el calendario; se elige el horario libre y el contacto. */
function BookingModal({ day, onClose, onBooked }: { day: string; onClose: () => void; onBooked: (day: string) => void }) {
  const [date, setDate] = useState(day);
  const [clients, setClients] = useState<Option[]>([]);
  const [clientId, setClientId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    fetch("/api/records/clients?limit=100").then(response => response.json()).then(data => {
      setClients((data.items || []).map((client: { _id: string; name: string }) => ({ value: client._id, label: client.name })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`/api/calendar/slots?date=${date}`)
      .then(response => response.json())
      .then(data => { if (active) { setSlots(data.slots || []); setTime(""); } })
      .catch(() => { if (active) setSlots([]); });
    return () => { active = false; };
  }, [date]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!time || !contactName.trim()) return;
    setSaving(true); setError("");
    const response = await fetch("/api/calendar/bookings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: clientId || undefined, contactName, contactPhone: contactPhone || undefined, contactEmail: contactEmail || undefined, date, time, notes: notes || undefined }),
    });
    const body = await response.json();
    setSaving(false);
    if (!response.ok) return setError(body.error || "No se pudo agendar el turno.");
    onBooked(date);
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="booking-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Plus /></span><div><p className="eyebrow">NUEVO TURNO</p><h2 id="booking-title">{longDay(date)}</h2><small>Si Google está conectado, el turno también queda en ese calendario</small></div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={submit}>
        <div className="modal-form-body"><div className="form-grid">
          <label><span>Día</span><input type="date" value={date} min={todayIso()} onChange={event => event.target.value && setDate(event.target.value)} /></label>
          <label><span>Cliente (opcional)</span><SearchSelect name="clientId" options={clients} value={clientId} onChange={value => { setClientId(value); const client = clients.find(option => option.value === value); if (client && !contactName) setContactName(client.label); }} placeholder="Sin vincular a un cliente" /></label>
          <label className="wide"><span>Horario *</span>
            {slots === null ? <p className="field-hint"><Loader2 size={13} className="spinning" /> Buscando horarios libres…</p>
              : !slots.length ? <p className="field-hint">No hay horarios libres ese día.</p>
              : <div className="slot-grid">{slots.map(slot => <button type="button" key={slot.time} className={time === slot.time ? "toggle active" : "toggle"} onClick={() => setTime(slot.time)}><Clock size={12} /> {slot.time}</button>)}</div>}
          </label>
          <label><span>Nombre de contacto *</span><input value={contactName} onChange={event => setContactName(event.target.value)} required maxLength={120} /></label>
          <label><span>Teléfono</span><input value={contactPhone} onChange={event => setContactPhone(event.target.value)} maxLength={50} /></label>
          <label className="wide"><span>Correo<em className="field-hint">Si lo cargás, Google le manda la invitación</em></span><input type="email" value={contactEmail} onChange={event => setContactEmail(event.target.value)} maxLength={120} /></label>
          <label className="wide"><span>Notas</span><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} /></label>
        </div></div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer><span>Queda registrado a tu nombre.</span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={saving || !time || !contactName.trim()}>{saving ? "Agendando…" : "Agendar turno"}</button></footer>
      </form>
    </section>
  </div>;
}

type CalendarSettingsView = {
  connected: boolean; userEmail?: string; calendarId: string; meetingDurationMinutes: number; slotIntervalMinutes: number; bufferBetweenMeetings: number;
  workingDays: number[]; workingHoursStart: string; workingHoursEnd: string; createMeetLink: boolean; defaultTitle: string; defaultDescription: string;
};

const DAY_LABELS = [{ value: 1, label: "Lun" }, { value: 2, label: "Mar" }, { value: 3, label: "Mié" }, { value: 4, label: "Jue" }, { value: 5, label: "Vie" }, { value: 6, label: "Sáb" }, { value: 7, label: "Dom" }];

/** La conexión con Google y las reglas de los turnos. Sólo gerencia. */
function CalendarSettingsPanel({ onChanged }: { onChanged: () => void }) {
  const [settings, setSettings] = useState<CalendarSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => fetch("/api/calendar/settings").then(response => response.json()).then(data => {
    if (data.error) setError(data.error); else setSettings(data);
  }).catch(() => setError("No se pudo cargar la configuración."));

  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true); setError(null); setMessage(null);
    const response = await fetch("/api/calendar/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
    const data = await response.json();
    setSaving(false);
    if (!response.ok) return setError(data.error || "No se pudo guardar.");
    setSettings(data); setMessage("Configuración guardada."); onChanged();
  }

  async function test() {
    setError(null); setMessage(null);
    const data = await (await fetch("/api/calendar/settings/test", { method: "POST" })).json();
    if (data.ok) setMessage(`Conexión exitosa (${data.email || "cuenta conectada"} · calendario: ${data.calendarName}).`);
    else setError(data.error || "No se pudo conectar.");
  }

  async function disconnectAccount() {
    if (!window.confirm("¿Desconectar la cuenta de Google? El calendario va a mostrar sólo los turnos de Pino.")) return;
    await fetch("/api/calendar/settings/disconnect", { method: "POST" });
    await load(); onChanged();
  }

  function toggleDay(day: number) {
    if (!settings) return;
    const workingDays = settings.workingDays.includes(day) ? settings.workingDays.filter(value => value !== day) : [...settings.workingDays, day].sort((a, b) => a - b);
    setSettings({ ...settings, workingDays });
  }

  if (!settings) return <div className="modal-form-body">{error ? <p className="notice error">{error}</p> : <p className="field-hint">Cargando…</p>}</div>;

  return <form onSubmit={save}>
    <div className="modal-form-body">
      {message && <p className="notice success" role="status">{message}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="calendar-connection">
        <span>{settings.connected ? `Conectada: ${settings.userEmail || "cuenta de Google"}.` : "No hay ninguna cuenta de Google conectada. Los turnos se guardan igual en Pino."}</span>
        {settings.connected
          ? <><button className="secondary-btn" type="button" onClick={() => { void test(); }}>Probar conexión</button><button className="secondary-btn" type="button" onClick={() => { void disconnectAccount(); }}>Desconectar</button></>
          : <a className="primary-btn" href="/api/calendar/oauth/start"><ExternalLink size={15} /> Conectar Google</a>}
      </div>
      <div className="form-grid settings-form">
        <label>Duración de la reunión (min)<input type="number" min={10} max={240} value={settings.meetingDurationMinutes} onChange={event => setSettings({ ...settings, meetingDurationMinutes: Number(event.target.value) })} /></label>
        <label>Intervalo entre horarios (min)<input type="number" min={5} max={120} value={settings.slotIntervalMinutes} onChange={event => setSettings({ ...settings, slotIntervalMinutes: Number(event.target.value) })} /></label>
        <label>Tiempo libre entre reuniones (min)<input type="number" min={0} max={120} value={settings.bufferBetweenMeetings} onChange={event => setSettings({ ...settings, bufferBetweenMeetings: Number(event.target.value) })} /></label>
        <label>Calendario de Google<input value={settings.calendarId} onChange={event => setSettings({ ...settings, calendarId: event.target.value })} placeholder="primary" /></label>
        <label>Horario desde<input type="time" value={settings.workingHoursStart} onChange={event => setSettings({ ...settings, workingHoursStart: event.target.value })} /></label>
        <label>Horario hasta<input type="time" value={settings.workingHoursEnd} onChange={event => setSettings({ ...settings, workingHoursEnd: event.target.value })} /></label>
        <label className="wide">Días laborales<div className="slot-grid">{DAY_LABELS.map(day => <button type="button" key={day.value} className={settings.workingDays.includes(day.value) ? "toggle active" : "toggle"} onClick={() => toggleDay(day.value)}>{day.label}</button>)}</div></label>
        <label className="wide calendar-check"><input type="checkbox" checked={settings.createMeetLink} onChange={event => setSettings({ ...settings, createMeetLink: event.target.checked })} /> Crear link de Google Meet automáticamente</label>
        <label className="wide">Título por defecto<input value={settings.defaultTitle} onChange={event => setSettings({ ...settings, defaultTitle: event.target.value })} /></label>
        <label className="wide">Descripción por defecto<textarea value={settings.defaultDescription} onChange={event => setSettings({ ...settings, defaultDescription: event.target.value })} /></label>
      </div>
    </div>
    <footer><span>Los cambios valen para los turnos nuevos.</span><button className="primary-btn" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar configuración"}</button></footer>
  </form>;
}
