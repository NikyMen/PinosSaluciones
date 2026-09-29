"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Check, CircleAlert, Gauge, Wrench, X } from "lucide-react";
import { DateInput, MoneyInput } from "@/components/fields";
import { date, money, qty, titleCase, todayIso } from "@/lib/format";
import { addMonthsIso, meterLabels, planState, planStateText, type AssetPlan } from "@/lib/assets";

/* ─────────────────────────────────────────────────────────────────────────────
   Mantenimiento de un bien de uso: lo que toca hacerle y lo que se le hizo.

   El caso de todos los días: a la camioneta se le hizo el service y hay que
   dejar anotado que el próximo es dentro de 3 meses (o a los 10.000 km). Se
   registra el service y en el mismo paso se programa el siguiente. Lo
   programado avisa solo antes de vencer y deja la tarea a Compras y logística.
   ───────────────────────────────────────────────────────────────────────────── */

type Plan = AssetPlan & { _id: string; createdAt?: string };
type Maintenance = { _id: string; date: string; kind: string; description: string; costCents?: number; reading?: number; provider?: string; notes?: string; userName?: string; expenseId?: string; planId?: string };
export type AssetRecord = {
  _id: string; name: string; identifier?: string; brand?: string; model?: string; status?: string; category?: string;
  meterUnit?: string; currentReading?: number; readingDate?: string; responsible?: string; location?: string;
  plans?: Plan[]; maintenance?: Maintenance[];
} & Record<string, unknown>;

const kinds = [
  { value: "service", label: "Service" }, { value: "preventivo", label: "Preventivo" }, { value: "reparacion", label: "Reparación" },
  { value: "inspeccion", label: "Inspección / VTV" }, { value: "otro", label: "Otro" },
];
const monthOptions = [1, 3, 6, 12];
const kindLabel = (value: string) => kinds.find(kind => kind.value === value)?.label || titleCase(value);
const toNumber = (value: FormDataEntryValue | null) => { const text = String(value ?? "").replace(/\./g, "").replace(",", ".").trim(); return text ? Number(text) : undefined; };

/** Cuándo toca el próximo: "dentro de N meses" (con la fecha a la vista) y/o a cierta lectura. */
function NextFields({ prefix, meterUnit, from, defaults }: { prefix: string; meterUnit?: string; from: string; defaults?: { title?: string; months?: number; readingEvery?: number; reading?: number } }) {
  const [months, setMonths] = useState<number | null>(defaults?.months === 0 ? null : defaults?.months ?? 3);
  // La fecha escrita a mano; con un atajo elegido ("3 meses") la fecha sale de la del service.
  const [customDate, setCustomDate] = useState("");
  const [picks, setPicks] = useState(0);
  const dueDate = months ? addMonthsIso(from, months) : customDate;
  const measured = meterUnit && meterUnit !== "ninguno";
  const unit = meterLabels[meterUnit || ""] || "";

  function pick(value: number | null) {
    setMonths(value);
    setCustomDate("");
    setPicks(count => count + 1);
  }

  return <div className="form-grid">
    <label className="wide"><span>¿Qué hay que hacer? *</span><input name={`${prefix}title`} required defaultValue={defaults?.title || ""} placeholder="Service de los 10.000 km, cambio de aceite y filtros…" /></label>
    <div className="wide asset-when">
      <span>¿Cuándo?</span>
      <div className="percent-quick">{monthOptions.map(value => <button key={value} type="button" className={months === value ? "active" : ""} onClick={() => pick(value)}>
        {value === 12 ? "1 año" : `${value} ${value === 1 ? "mes" : "meses"}`}</button>)}
        <button type="button" className={months === null && !dueDate ? "active" : ""} onClick={() => pick(null)}>Sin fecha</button>
      </div>
    </div>
    <label><span>Fecha</span>{/* Se vuelve a armar al elegir un atajo o al cambiar la fecha del service, no mientras se tipea. */}
      <DateInput key={`${picks}-${from}`} name={`${prefix}dueDate`} defaultValue={dueDate} hideToday onValueChange={value => { setCustomDate(value); setMonths(null); }} /></label>
    <input type="hidden" name={`${prefix}intervalMonths`} value={months ?? ""} />
    {measured && <label><span>O a los ({unit})</span><input name={`${prefix}dueReading`} inputMode="numeric" defaultValue={defaults?.reading != null && defaults?.readingEvery ? String(defaults.reading + defaults.readingEvery) : ""} placeholder={`Ej. 60000 ${unit}`} /><em className="field-hint">Lo primero que llegue</em></label>}
    {measured && <label><span>Se repite cada ({unit})</span><input name={`${prefix}intervalReading`} inputMode="numeric" defaultValue={defaults?.readingEvery ? String(defaults.readingEvery) : ""} placeholder={`Ej. 10000 ${unit}`} /></label>}
  </div>;
}

function readNext(form: FormData, prefix: string) {
  const title = String(form.get(`${prefix}title`) || "").trim();
  return {
    title, dueDate: String(form.get(`${prefix}dueDate`) || "") || undefined,
    dueReading: toNumber(form.get(`${prefix}dueReading`)), intervalMonths: toNumber(form.get(`${prefix}intervalMonths`)), intervalReading: toNumber(form.get(`${prefix}intervalReading`)),
  };
}

export function AssetMaintenanceModal({ assetId, canEdit, onClose, onChanged }: { assetId: string; canEdit: boolean; onClose: () => void; onChanged: (asset: AssetRecord) => void }) {
  const [asset, setAsset] = useState<AssetRecord | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  // Qué formulario está abierto: registrar un service (quizás de un programado), programar uno, o cargar la lectura.
  const [form, setForm] = useState<{ kind: "service"; plan?: Plan } | { kind: "plan" } | { kind: "reading" } | null>(null);
  const [serviceDate, setServiceDate] = useState(todayIso());
  const [scheduleNext, setScheduleNext] = useState(true);

  useEffect(() => {
    void fetch(`/api/assets/${assetId}/maintenance`).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo cargar el bien");
      setAsset(result as AssetRecord);
    }).catch(problem => setError(problem instanceof Error ? problem.message : "No se pudo cargar el bien"));
  }, [assetId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function send(body: Record<string, unknown>, message: string) {
    setSaving(true); setError("");
    const response = await fetch(`/api/assets/${assetId}/maintenance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) { setError(result.error || "No se pudo guardar"); return false; }
    setAsset(result.asset as AssetRecord);
    onChanged(result.asset as AssetRecord);
    setNotice(message);
    setForm(null);
    return true;
  }

  function openService(plan?: Plan) {
    setServiceDate(todayIso());
    // Si el programado se repite, el siguiente se ofrece ya cargado; si no, igual se sugiere programar uno.
    setScheduleNext(true);
    setForm({ kind: "service", plan });
    setNotice("");
  }

  function submitService(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = scheduleNext ? readNext(data, "next_") : null;
    const plan = form?.kind === "service" ? form.plan : undefined;
    void send({
      action: "service", date: String(data.get("date") || todayIso()), kind: String(data.get("kind") || "service"),
      description: String(data.get("description") || ""), costCents: Math.round(Number(data.get("costCents") || 0) * 100),
      reading: toNumber(data.get("reading")), provider: String(data.get("provider") || ""), notes: String(data.get("notes") || ""),
      createExpense: data.get("createExpense") === "on", planId: plan?._id || "", next: next && next.title ? next : undefined,
    }, next?.title ? `Service registrado y el próximo quedó programado: ${next.title}${next.dueDate ? ` para el ${date(next.dueDate)}` : ""}.` : "Service registrado.");
  }

  function submitPlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = readNext(new FormData(event.currentTarget), "plan_");
    void send({ action: "plan", ...next }, `Programado: ${next.title}${next.dueDate ? ` para el ${date(next.dueDate)}` : ""}. Avisa ${14} días antes.`);
  }

  function submitReading(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void send({ action: "reading", reading: toNumber(data.get("reading")), date: String(data.get("date") || "") || undefined }, "Lectura actualizada.");
  }

  function cancelPlan(plan: Plan) {
    if (!confirm(`¿Sacar "${plan.title}" de lo programado? Deja de avisar.`)) return;
    void send({ action: "cancel_plan", planId: plan._id }, "Mantenimiento programado cancelado.");
  }

  const measured = asset?.meterUnit && asset.meterUnit !== "ninguno";
  const unit = meterLabels[asset?.meterUnit || ""] || "";
  const pending = (asset?.plans || []).filter(plan => (plan.status || "pendiente") === "pendiente")
    .map(plan => ({ plan, state: planState(plan, asset!) }))
    .sort((a, b) => (a.plan.dueDate ? new Date(a.plan.dueDate).getTime() : Infinity) - (b.plan.dueDate ? new Date(b.plan.dueDate).getTime() : Infinity));
  const closed = (asset?.plans || []).filter(plan => plan.status && plan.status !== "pendiente");
  const history = (asset?.maintenance || []).slice().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const servicePlan = form?.kind === "service" ? form.plan : undefined;

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal asset-modal" role="dialog" aria-modal="true" aria-labelledby="asset-modal-title">
      <header>
        <div className="modal-title-wrap"><span className="modal-heading-icon"><Wrench /></span><div>
          <p className="eyebrow">MANTENIMIENTO</p>
          <h2 id="asset-modal-title">{asset?.name || "Bien de uso"}</h2>
          <small>{asset ? [asset.identifier, [asset.brand, asset.model].filter(Boolean).join(" "), asset.responsible && `A cargo de ${asset.responsible}`].filter(Boolean).join(" · ") || "Services, arreglos y lo que toca hacerle" : "Cargando…"}</small>
        </div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>

      {!asset ? <div className="modal-form-body">{error ? <p className="form-error">{error}</p> : <div className="loading-state">Cargando…</div>}</div> : <>
        <div className="stock-summary asset-summary">
          <div><span>Estado</span><strong><span className={`badge ${asset.status}`}>{titleCase(asset.status)}</span></strong></div>
          <div><span>Uso</span><strong>{measured ? asset.currentReading != null ? `${qty(asset.currentReading, 0)} ${unit}` : "Sin cargar" : "No se mide"}</strong><small>{asset.readingDate ? `Al ${date(asset.readingDate)}` : ""}</small></div>
          <div><span>Próximo</span><strong className={pending[0]?.state.state === "vencido" ? "below" : ""}>{pending[0] ? pending[0].plan.title : "Nada programado"}</strong><small>{pending[0] ? planStateText(pending[0].state, asset.meterUnit) : ""}</small></div>
          <div><span>Services</span><strong>{history.length}</strong><small>{history[0] ? `Último el ${date(history[0].date)}` : ""}</small></div>
        </div>

        {canEdit && <div className="stock-tabs">
          <button type="button" className={form?.kind === "service" && !servicePlan ? "active" : ""} onClick={() => openService()}><Wrench size={15} /> Registrar service o arreglo</button>
          <button type="button" className={form?.kind === "plan" ? "active" : ""} onClick={() => { setForm({ kind: "plan" }); setNotice(""); }}><CalendarClock size={15} /> Programar mantenimiento</button>
          {measured && <button type="button" className={form?.kind === "reading" ? "active" : ""} onClick={() => { setForm({ kind: "reading" }); setNotice(""); }}><Gauge size={15} /> Cargar {asset.meterUnit === "km" ? "kilómetros" : "horas"}</button>}
        </div>}

        {notice && <div className="notice success stock-done"><Check size={17} /><span>{notice}</span></div>}
        {error && <p className="form-error modal-error">{error}</p>}

        {form?.kind === "service" && <form onSubmit={submitService} key={servicePlan?._id || "free"}>
          <div className="modal-form-body">
            {servicePlan && <p className="stock-help">Registrás lo programado: <b>{servicePlan.title}</b>. Queda como hecho y deja de avisar.</p>}
            <div className="form-grid">
              <label><span>Fecha *</span><DateInput name="date" required recent defaultValue={serviceDate} onValueChange={value => { if (value) setServiceDate(value); }} /></label>
              <label><span>Tipo *</span><select name="kind" defaultValue={servicePlan ? "preventivo" : "service"}>{kinds.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></label>
              <label className="wide"><span>¿Qué se le hizo? *</span><input name="description" required defaultValue={servicePlan?.title || ""} placeholder="Service completo, cambio de aceite y filtros…" /></label>
              {measured && <label><span>{asset.meterUnit === "km" ? "Kilómetros" : "Horas"} ese día</span><input name="reading" inputMode="numeric" defaultValue={asset.currentReading != null ? String(asset.currentReading) : ""} /></label>}
              <label><span>Costo</span><MoneyInput name="costCents" /></label>
              <label><span>Taller / proveedor</span><input name="provider" placeholder="Dónde se hizo" /></label>
              <label className="asset-check"><input type="checkbox" name="createExpense" /> <span>Cargar el costo en Compras y gastos</span></label>
              <label className="wide"><span>Observaciones</span><textarea name="notes" rows={2} /></label>
            </div>
            <div className="asset-next">
              <label className="asset-check strong"><input type="checkbox" checked={scheduleNext} onChange={event => setScheduleNext(event.target.checked)} /> <span>Programar el próximo mantenimiento</span></label>
              {scheduleNext && <NextFields prefix="next_" meterUnit={asset.meterUnit} from={serviceDate}
                defaults={{ title: servicePlan?.title || "", months: servicePlan ? (servicePlan.intervalMonths ?? (servicePlan.dueDate ? 3 : 0)) : 3, readingEvery: servicePlan?.intervalReading ?? undefined, reading: asset.currentReading }} />}
            </div>
          </div>
          <footer><span>Queda registrado a tu nombre.</span><button type="button" className="secondary-btn" onClick={() => setForm(null)}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving ? "Guardando…" : <><Check size={16} /> Registrar</>}</button></footer>
        </form>}

        {form?.kind === "plan" && <form onSubmit={submitPlan}>
          <div className="modal-form-body">
            <p className="stock-help">Lo que toca hacerle y cuándo. Avisa 14 días antes (o cuando falte poco de uso) y le deja la tarea a Compras y logística.</p>
            <NextFields prefix="plan_" meterUnit={asset.meterUnit} from={todayIso()} defaults={{ months: 3 }} />
          </div>
          <footer><span>Se puede cancelar después.</span><button type="button" className="secondary-btn" onClick={() => setForm(null)}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving ? "Guardando…" : <><CalendarClock size={16} /> Programar</>}</button></footer>
        </form>}

        {form?.kind === "reading" && <form onSubmit={submitReading}>
          <div className="modal-form-body"><div className="form-grid">
            <label><span>{asset.meterUnit === "km" ? "Kilómetros del tablero" : "Horas del horómetro"} *</span><input name="reading" inputMode="numeric" required autoFocus defaultValue={asset.currentReading != null ? String(asset.currentReading) : ""} /></label>
            <label><span>Fecha</span><DateInput name="date" recent defaultValue={todayIso()} /></label>
          </div></div>
          <footer><span>Si algo vence por uso, avisa en el momento.</span><button type="button" className="secondary-btn" onClick={() => setForm(null)}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button></footer>
        </form>}

        <div className="modal-form-body">
          <div className="task-form-heading"><div><p className="eyebrow">PROGRAMADO</p><h3>Lo que toca hacerle</h3></div><span>Lo más próximo primero</span></div>
          {!pending.length ? <p className="task-history-state">No hay nada programado.{canEdit ? " Registrá el último service y programá el próximo desde ahí." : ""}</p>
            : <div className="detail-list">{pending.map(({ plan, state }) => <div className={`detail-row asset-plan ${state.state}`} key={plan._id}>
              <span className={`badge ${state.state === "vencido" ? "anulada" : state.state === "proximo" ? "pendiente" : "activo"}`}>{state.state === "vencido" ? "Vencido" : state.state === "proximo" ? "Se acerca" : "Al día"}</span>
              <b>{plan.title}</b>
              <span>{[plan.dueDate && date(plan.dueDate), plan.dueReading != null && `${qty(plan.dueReading, 0)} ${unit}`].filter(Boolean).join(" o ") || "—"}</span>
              <small>{state.state !== "al_dia" && <CircleAlert size={13} />} {planStateText(state, asset.meterUnit)}{plan.intervalMonths ? ` · cada ${plan.intervalMonths} ${plan.intervalMonths === 1 ? "mes" : "meses"}` : ""}</small>
              {canEdit && <span className="asset-plan-actions">
                <button type="button" className="row-action-wide approve" onClick={() => openService(plan)}><Check size={14} /> Hecho</button>
                <button type="button" className="icon-btn" title="Cancelar este mantenimiento" onClick={() => cancelPlan(plan)}><X size={15} /></button>
              </span>}
            </div>)}</div>}
        </div>

        <div className="modal-form-body">
          <div className="task-form-heading"><div><p className="eyebrow">HISTORIAL</p><h3>Lo que se le hizo</h3></div><span>Más recientes primero</span></div>
          {!history.length ? <p className="task-history-state">Todavía no hay services registrados.</p>
            : <div className="detail-list">{history.map(entry => <div className="detail-row asset-history" key={entry._id}>
              <span className="badge">{kindLabel(entry.kind)}</span>
              <b>{entry.description}</b>
              <span>{date(entry.date)}{entry.reading != null ? ` · ${qty(entry.reading, 0)} ${unit}` : ""}{entry.provider ? ` · ${entry.provider}` : ""}</span>
              <strong>{entry.costCents ? money(entry.costCents) : "—"}</strong>
              <small>{entry.userName || "—"}{entry.expenseId ? " · cargado en gastos" : ""}{entry.notes ? ` · ${entry.notes}` : ""}</small>
            </div>)}</div>}
          {closed.length > 0 && <p className="asset-closed">{closed.length} {closed.length === 1 ? "mantenimiento programado ya cerrado" : "mantenimientos programados ya cerrados"} ({closed.filter(plan => plan.status === "hecho").length} hechos, {closed.filter(plan => plan.status === "cancelado").length} cancelados).</p>}
        </div>
      </>}
    </section>
  </div>;
}

/** El próximo mantenimiento en la tabla: la fecha, con color si vence o ya venció. */
export function NextDueCell({ item }: { item: Record<string, unknown> }) {
  if (!item.nextDueDate && item.nextDueReading == null) return <span className="muted">—</span>;
  const state = planState({ title: String(item.nextDueTitle || ""), dueDate: item.nextDueDate as string | undefined, dueReading: item.nextDueReading as number | undefined }, { currentReading: item.currentReading as number | undefined, meterUnit: String(item.meterUnit || "") });
  const unit = meterLabels[String(item.meterUnit || "")] || "";
  return <span className={`cell-stack asset-due ${state.state}`}>
    <b>{item.nextDueDate ? date(String(item.nextDueDate)) : `${qty(Number(item.nextDueReading), 0)} ${unit}`}</b>
    <small>{String(item.nextDueTitle || "")}{state.state !== "al_dia" ? ` · ${planStateText(state, String(item.meterUnit || ""))}` : ""}</small>
  </span>;
}

