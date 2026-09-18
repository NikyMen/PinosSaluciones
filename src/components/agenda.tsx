"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CalendarDays, Clock, ExternalLink, Loader2, Plus, Settings2, Trash2, Video } from "lucide-react";
import { dateTime, todayIso } from "@/lib/format";
import { DateInput, SearchSelect, type Option } from "@/components/fields";
import { AgendaChat } from "@/components/agenda-chat";

type Booking = {
  _id: string;
  contactName: string;
  meetUrl?: string;
  startAt: string;
};

type Slot = { time: string; startIso: string; endIso: string };

type CalendarSettingsView = {
  connected: boolean;
  userEmail?: string;
  calendarId: string;
  meetingDurationMinutes: number;
  slotIntervalMinutes: number;
  bufferBetweenMeetings: number;
  workingDays: number[];
  workingHoursStart: string;
  workingHoursEnd: string;
  createMeetLink: boolean;
  defaultTitle: string;
  defaultDescription: string;
};

const DAY_LABELS = [
  { value: 1, label: "Lun" }, { value: 2, label: "Mar" }, { value: 3, label: "Mié" }, { value: 4, label: "Jue" },
  { value: 5, label: "Vie" }, { value: 6, label: "Sáb" }, { value: 7, label: "Dom" },
];

function oauthQueryParam(key: string) {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

export function Agenda({ isManager }: { isManager: boolean }) {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(() => oauthQueryParam("calendarError"));
  const [notice, setNotice] = useState<string | null>(() => (oauthQueryParam("calendarConnected") ? "Cuenta de Google conectada correctamente." : null));

  const [clients, setClients] = useState<Option[]>([]);
  const [clientId, setClientId] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [date, setDate] = useState(todayIso());
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search) window.history.replaceState(null, "", "/app/calendario");
  }, []);

  async function loadBookings() {
    try {
      const res = await fetch("/api/calendar/bookings");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudieron cargar los turnos.");
      setBookings(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar los turnos.");
    }
  }

  useEffect(() => {
    fetch("/api/calendar/bookings").then(res => res.json()).then(data => {
      if (data.items) setBookings(data.items);
      else setError(data.error || "No se pudieron cargar los turnos.");
    }).catch(() => setError("No se pudieron cargar los turnos."));
    fetch("/api/records/clients?limit=200").then(res => res.json()).then(data => {
      setClients((data.items || []).map((client: { _id: string; name: string }) => ({ value: client._id, label: client.name })));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => { setSlotsLoading(true); setTime(""); })
      .then(() => fetch(`/api/calendar/slots?date=${date}`))
      .then(res => res.json())
      .then(data => { if (active) setSlots(data.slots || []); })
      .catch(() => { if (active) setSlots([]); })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [date]);

  async function createBooking(event: FormEvent) {
    event.preventDefault();
    if (!time || !contactName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId || undefined,
          contactName,
          contactPhone: contactPhone || undefined,
          contactEmail: contactEmail || undefined,
          date, time,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo agendar el turno.");
      setNotice("Turno agendado correctamente.");
      setClientId(""); setContactName(""); setContactPhone(""); setContactEmail(""); setNotes(""); setTime("");
      await loadBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agendar el turno.");
    } finally {
      setCreating(false);
    }
  }

  async function cancel(id: string) {
    if (!window.confirm("¿Cancelar este turno?")) return;
    try {
      const res = await fetch(`/api/calendar/bookings/${id}`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo cancelar el turno.");
      await loadBookings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cancelar el turno.");
    }
  }

  return (
    <>
      <div className="page-heading">
        <div><p className="eyebrow">GESTIÓN</p><h1>Agenda</h1><p>Turnos y reuniones, sincronizados con Google Calendar.</p></div>
      </div>

      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}

      <div className="agenda-grid">
        <section className="panel">
          <div className="panel-head">
            <div className="section-title"><Plus aria-hidden="true" /><div><h2>Nuevo turno</h2><p>Elegí un horario libre y confirmá los datos de contacto.</p></div></div>
          </div>
          <form className="form-grid" onSubmit={createBooking} style={{ padding: 20 }}>
            <label className="wide">Cliente (opcional)<SearchSelect name="clientId" options={clients} value={clientId} onChange={setClientId} placeholder="Sin vincular a un cliente" /></label>
            <label>Nombre de contacto<input value={contactName} onChange={event => setContactName(event.target.value)} required maxLength={120} /></label>
            <label>Teléfono<input value={contactPhone} onChange={event => setContactPhone(event.target.value)} maxLength={50} /></label>
            <label>Email<input type="email" value={contactEmail} onChange={event => setContactEmail(event.target.value)} maxLength={120} /></label>
            <label>Fecha<DateInput name="date" defaultValue={date} onValueChange={value => value && setDate(value)} /></label>
            <label className="wide">
              Horario
              {slotsLoading ? <p className="field-hint"><Loader2 size={13} className="spinning" aria-hidden="true" /> Buscando horarios libres...</p>
                : !slots ? null
                : slots.length === 0 ? <p className="field-hint">No hay horarios libres ese día.</p>
                : <div className="slot-grid">
                  {slots.map(slot => (
                    <button type="button" key={slot.time} className={time === slot.time ? "toggle active" : "toggle"} onClick={() => setTime(slot.time)}>
                      <Clock size={12} aria-hidden="true" /> {slot.time}
                    </button>
                  ))}
                </div>}
            </label>
            <label className="wide">Notas<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1_000} /></label>
            <button className="primary-btn" type="submit" disabled={creating || !time || !contactName.trim()} style={{ gridColumn: "1 / -1" }}>
              {creating ? "Agendando..." : "Agendar turno"}
            </button>
          </form>
        </section>

        <section className="panel table-panel">
          <div className="panel-head">
            <div className="section-title"><CalendarDays aria-hidden="true" /><div><h2>Próximos turnos</h2><p>{bookings?.length ?? 0} agendados</p></div></div>
          </div>
          {bookings === null ? <div className="empty-state compact"><Loader2 className="spinning" aria-hidden="true" /><p>Cargando...</p></div>
            : bookings.length === 0 ? <div className="empty-state compact"><CalendarDays aria-hidden="true" /><p>Todavía no hay turnos agendados.</p></div>
            : <ul className="agenda-list">
              {bookings.map(booking => (
                <li key={booking._id} className="agenda-item">
                  <div>
                    <b>{booking.contactName}</b>
                    <p>{dateTime(booking.startAt)}</p>
                    {booking.meetUrl && <a href={booking.meetUrl} target="_blank" rel="noreferrer"><Video size={13} aria-hidden="true" /> Meet</a>}
                  </div>
                  <button className="secondary-btn compact" type="button" onClick={() => cancel(booking._id)}><Trash2 size={14} aria-hidden="true" /> Cancelar</button>
                </li>
              ))}
            </ul>}
        </section>
      </div>

      {isManager && <CalendarSettingsPanel />}

      <AgendaChat onBooked={loadBookings} />
    </>
  );
}

function CalendarSettingsPanel() {
  const [settings, setSettings] = useState<CalendarSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/calendar/settings");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo cargar la configuración.");
      setSettings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la configuración.");
    }
  }

  useEffect(() => {
    fetch("/api/calendar/settings").then(res => res.json()).then(data => {
      if (data.error) setError(data.error);
      else setSettings(data);
    }).catch(() => setError("No se pudo cargar la configuración."));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/calendar/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo guardar.");
      setSettings(data);
      setMessage("Configuración guardada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setError(null); setMessage(null);
    const res = await fetch("/api/calendar/settings/test", { method: "POST" });
    const data = await res.json();
    if (data.ok) setMessage(`Conexión exitosa (${data.email || "cuenta conectada"} · calendario: ${data.calendarName}).`);
    else setError(data.error || "No se pudo conectar.");
  }

  async function disconnectAccount() {
    if (!window.confirm("¿Desconectar la cuenta de Google?")) return;
    await fetch("/api/calendar/settings/disconnect", { method: "POST" });
    await load();
  }

  function toggleDay(day: number) {
    if (!settings) return;
    const workingDays = settings.workingDays.includes(day)
      ? settings.workingDays.filter(value => value !== day)
      : [...settings.workingDays, day].sort((a, b) => a - b);
    setSettings({ ...settings, workingDays });
  }

  if (!settings) return null;

  return (
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <div className="section-title"><Settings2 aria-hidden="true" /><div><h2>Configuración de Google Calendar</h2><p>Solo gerencia puede conectar la cuenta y ajustar las reglas.</p></div></div>
        {settings.connected
          ? <button className="secondary-btn" type="button" onClick={disconnectAccount}>Desconectar</button>
          : <a className="primary-btn" href="/api/calendar/oauth/start"><ExternalLink size={15} aria-hidden="true" /> Conectar Google</a>}
      </div>
      <div style={{ padding: 20 }}>
        {message && <p className="notice" role="status">{message}</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
        <p className="field-hint">
          {settings.connected
            ? `Conectada: ${settings.userEmail || "cuenta de Google"}.`
            : "No hay ninguna cuenta conectada. Los turnos se guardan igual en Pino Soluciones, pero no en Google Calendar."}
        </p>
        {settings.connected && <button className="secondary-btn compact" type="button" onClick={test}>Probar conexión</button>}

        <form className="form-grid settings-form" onSubmit={save} style={{ marginTop: 16 }}>
          <label>Duración de la reunión (min)<input type="number" min={10} max={240} value={settings.meetingDurationMinutes} onChange={event => setSettings({ ...settings, meetingDurationMinutes: Number(event.target.value) })} /></label>
          <label>Intervalo entre horarios (min)<input type="number" min={5} max={120} value={settings.slotIntervalMinutes} onChange={event => setSettings({ ...settings, slotIntervalMinutes: Number(event.target.value) })} /></label>
          <label>Buffer entre reuniones (min)<input type="number" min={0} max={120} value={settings.bufferBetweenMeetings} onChange={event => setSettings({ ...settings, bufferBetweenMeetings: Number(event.target.value) })} /></label>
          <label>Calendario<input value={settings.calendarId} onChange={event => setSettings({ ...settings, calendarId: event.target.value })} placeholder="primary" /></label>
          <label>Horario desde<input type="time" value={settings.workingHoursStart} onChange={event => setSettings({ ...settings, workingHoursStart: event.target.value })} /></label>
          <label>Horario hasta<input type="time" value={settings.workingHoursEnd} onChange={event => setSettings({ ...settings, workingHoursEnd: event.target.value })} /></label>
          <label className="wide">
            Días laborales
            <div className="slot-grid">
              {DAY_LABELS.map(day => (
                <button type="button" key={day.value} className={settings.workingDays.includes(day.value) ? "toggle active" : "toggle"} onClick={() => toggleDay(day.value)}>{day.label}</button>
              ))}
            </div>
          </label>
          <label className="wide"><input type="checkbox" checked={settings.createMeetLink} onChange={event => setSettings({ ...settings, createMeetLink: event.target.checked })} /> Crear link de Google Meet automáticamente</label>
          <label className="wide">Título por defecto<input value={settings.defaultTitle} onChange={event => setSettings({ ...settings, defaultTitle: event.target.value })} /></label>
          <label className="wide">Descripción por defecto<textarea value={settings.defaultDescription} onChange={event => setSettings({ ...settings, defaultDescription: event.target.value })} /></label>
          <button className="primary-btn" type="submit" disabled={saving} style={{ gridColumn: "1 / -1" }}>{saving ? "Guardando..." : "Guardar configuración"}</button>
        </form>
      </div>
    </section>
  );
}
