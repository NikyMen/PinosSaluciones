"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TriangleAlert, ArrowLeft, ArrowRight, Check, CheckCircle2, ClipboardCheck, CloudSun, HardHat, ImagePlus, Lock, Package,
  Palette, Plus, Save, ShieldCheck, Trash2, Users, X,
} from "lucide-react";
import { DateInput } from "@/components/fields";
import { date, dateTime, qty, titleCase, todayIso } from "@/lib/format";
import {
  CHECK_RESULTS, COLOR_SECTORS, INSPECTION_RUBROS, MATERIAL_CONDITIONS, ORDER_STATUS, PERFORMANCE, PRODUCTION_CONSUMPTION, WEATHER,
  closeProblems, computeWorkProgress, deviationLabels, inspectionAlerts, inspectionTemplates, lineProgress, materialControl, optionLabels, rubroLabel,
  type InspectionAlert, type InspectionDraft, type InspectionRubro, type LineProgress, type MaterialControl, type StaffSummary,
} from "@/lib/inspections";

/* ─── Tipos que devuelve la API ────────────────────────────────────────────── */

type Check = { key: string; label: string; result: string; notes: string };
type ProductionRow = { lineId?: string; label: string; unit: string; plannedQty: number; todayQty?: number | null; previousQty?: number; accumulatedQty?: number; progressPct?: number | null };
type Received = { source: "stock" | "manual"; stockItemId?: string; movementId?: string; name: string; unit: string; quantity: number; condition: string; notes: string };
type MainMaterial = {
  stockItemId?: string; name?: string; unit?: string; plannedQty?: number; stockStart?: number; receivedToday?: number; stockEnd?: number; notes?: string;
  previousConsumption?: number; receivedPrevious?: number; receivedAccumulated?: number; consumptionToday?: number; consumptionAccumulated?: number;
  remaining?: number | null; consumptionPct?: number | null; enough?: boolean | null; deviation?: keyof typeof deviationLabels | null;
};
type Staff = { source: "partes" | "manual"; oficiales: number; medioOficiales: number; ayudantes: number; otros: number; hoursWorked: number; checkIn?: string; checkOut?: string; people?: StaffSummary["people"] };
type Shortage = { material: string; quantity: number; unit: string };
type ColorRow = { sector: string; color: string; paintType: string; brand: string; notes: string };

export type Inspection = {
  _id: string; workId: string; date: string; dayKey: string; rubro: InspectionRubro; status: "borrador" | "cerrada";
  managerName: string; weather: string; qualityResponsibleName: string;
  staff: Staff; production: ProductionRow[]; rubroProgressPct?: number | null; workProgressPct?: number | null;
  stage: string; performance: string; lowPerformanceReason: string; productionConsumption: string;
  quality: Check[]; qualityNotes: string;
  materialsReceived: Received[]; mainMaterial: MainMaterial;
  shortages: Shortage[]; shortageNeededBy?: string; shortageOrderStatus: string;
  safety: Check[]; incidents: string; colors: ColorRow[]; photos: string[]; notes: string;
  alerts: InspectionAlert[]; createdByName?: string; closedAt?: string; closedByName?: string;
};

type Delivery = { stockItemId: string; movementId: string; name: string; unit: string; quantity: number };
type Context = {
  staff: StaffSummary; deliveries: Delivery[]; previousByLine: Record<string, number>;
  previousMaterial: { name: string; unit?: string; plannedQty?: number; stockEnd?: number; consumptionAccumulated?: number; receivedAccumulated?: number; dayKey?: string } | null;
  progress: { overall: number | null; lines: LineProgress[]; mode: string; progress: number };
};
type WorkHeader = { _id: string; code: string; name: string; startDate?: string; endDate?: string; clientName: string; address: string };
type Loaded = { inspection: Inspection; work: WorkHeader; context: Context; canEdit: boolean };

const STEPS = [
  { title: "Datos del día", icon: CloudSun },
  { title: "Personal y rendimiento", icon: Users },
  { title: "Calidad", icon: ClipboardCheck },
  { title: "Materiales y faltantes", icon: Package },
  { title: "Seguridad", icon: ShieldCheck },
  { title: "Revisión y cierre", icon: Lock },
] as const;

const normalized = (value?: string) => String(value || "").trim().toLowerCase();

/* ─── Alta: elegir el día y el rubro ───────────────────────────────────────── */

/**
 * Lo que abre el ícono de inspección del listado. Pide solo el día y el rubro;
 * con eso el servidor arma la inspección (puntos de control, personal del día,
 * material de la inspección anterior) y se pasa directo a cargarla.
 */
export function NewInspection({ workId }: { workId: string }) {
  const router = useRouter();
  const [work, setWork] = useState<{ code: string; name: string; progressBase?: Array<{ rubro: InspectionRubro }> } | null>(null);
  const [drafts, setDrafts] = useState<Array<{ _id: string; dayKey: string; rubro: InspectionRubro }>>([]);
  const [day, setDay] = useState(todayIso());
  const [rubro, setRubro] = useState<InspectionRubro | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [existingId, setExistingId] = useState("");

  useEffect(() => {
    void Promise.all([fetch(`/api/records/works/${workId}`), fetch(`/api/works/${workId}/inspections`)]).then(async ([workResponse, listResponse]) => {
      const workResult = await workResponse.json();
      if (!workResponse.ok) return setError(workResult.error || "No se pudo cargar la obra");
      setWork(workResult);
      const baseRubros = [...new Set(((workResult.progressBase || []) as Array<{ rubro: InspectionRubro }>).map(line => line.rubro))];
      if (baseRubros.length === 1) setRubro(baseRubros[0]);
      if (listResponse.ok) {
        const list = await listResponse.json();
        setDrafts(((list.items || []) as Array<{ _id: string; dayKey: string; rubro: InspectionRubro; status: string }>).filter(item => item.status === "borrador"));
      }
    }).catch(() => setError("No se pudo cargar la obra"));
  }, [workId]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (!rubro) return setError("Elegí el rubro que vas a inspeccionar");
    if (!day) return setError("Elegí el día de la inspección");
    setBusy(true); setError(""); setExistingId("");
    const response = await fetch(`/api/works/${workId}/inspections`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: day, rubro }) });
    const result = await response.json();
    setBusy(false);
    if (response.status === 409 && result.existingId) { setExistingId(result.existingId); return setError(result.error); }
    if (!response.ok) return setError(result.error || "No se pudo abrir la inspección");
    router.replace(`/app/works/${workId}/inspections/${result._id}`);
  }

  const inBase = new Set((work?.progressBase || []).map(line => line.rubro));

  return <>
    <Link href={`/app/works/${workId}`} className="back-link"><ArrowLeft /> Volver a la obra</Link>
    <div className="page-heading"><div><p className="eyebrow">{work ? `OBRA ${work.code}` : "OBRA"}</p><h1>Nueva inspección</h1><p>{work?.name || "Cargando…"}</p></div></div>
    <form className="panel insp-new" onSubmit={start}>
      <div className="insp-new-grid">
        <label className="insp-field"><span>Día de la inspección *</span><DateInput name="date" defaultValue={day} onValueChange={setDay} required /></label>
        <div className="insp-field wide"><span>Rubro *</span>
          <div className="insp-rubros" role="radiogroup" aria-label="Rubro">
            {INSPECTION_RUBROS.map(option => <button key={option} type="button" role="radio" aria-checked={rubro === option} className={rubro === option ? "active" : ""} onClick={() => setRubro(option)}>
              <b>{inspectionTemplates[option].label}</b>
              <small>{inspectionTemplates[option].quality.length} puntos de calidad{inspectionTemplates[option].colors ? " · colores" : ""}</small>
              {inBase.has(option) && <em>En la base de avance</em>}
            </button>)}
          </div>
        </div>
      </div>
      {error && <div className="notice error insp-notice">{error}{existingId && <> <Link href={`/app/works/${workId}/inspections/${existingId}`}>Abrir la de ese día</Link></>}</div>}
      <footer className="insp-new-footer"><span>Se abre en borrador: podés guardarla y seguir después.</span><button className="primary-btn" disabled={busy || !work}><ClipboardCheck size={17} /> {busy ? "Abriendo…" : "Comenzar inspección"}</button></footer>
    </form>
    {drafts.length > 0 && <section className="panel insp-drafts">
      <div className="panel-head"><div className="section-title"><Save /><h2>Borradores sin cerrar</h2></div></div>
      <div className="detail-list">{drafts.map(item => <Link className="detail-row insp-history-row" key={item._id} href={`/app/works/${workId}/inspections/${item._id}`}>
        <b>{date(item.dayKey)}</b><span>{rubroLabel(item.rubro)}</span><span className="badge pendiente">Borrador</span>
      </Link>)}</div>
    </section>}
  </>;
}

/* ─── Carga y consulta ─────────────────────────────────────────────────────── */

export function InspectionForm({ workId, inspectionId }: { workId: string; inspectionId: string }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<Inspection | null>(null);
  const [step, setStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [serverProblems, setServerProblems] = useState<string[]>([]);

  const load = useCallback(async () => {
    const response = await fetch(`/api/works/${workId}/inspections/${inspectionId}`);
    const result = await response.json();
    if (!response.ok) return setError(result.error || "No se pudo cargar la inspección");
    setLoaded(result);
    setDraft(normalize(result.inspection));
    setDirty(false);
  }, [workId, inspectionId]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  // Cerrar la pestaña con cambios sin guardar pregunta antes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const editable = Boolean(loaded?.canEdit && draft?.status === "borrador");

  const change = useCallback((patch: Partial<Inspection>) => {
    setDraft(current => current ? { ...current, ...patch } : current);
    setDirty(true); setMessage("");
  }, []);

  /* Las cuentas en vivo: las mismas funciones que usa el servidor al cerrar. */
  const calc = useMemo(() => draft && loaded ? liveCalculations(draft, loaded.context) : null, [draft, loaded]);

  async function save(silent = false) {
    if (!draft || !editable) return true;
    setSaving(true); setError("");
    const response = await fetch(`/api/works/${workId}/inspections/${inspectionId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(draft)) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) { setError(result.error || "No se pudo guardar el borrador"); return false; }
    setDirty(false);
    if (!silent) setMessage(`Borrador guardado a las ${new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.`);
    return true;
  }

  async function goTo(next: number) {
    if (dirty && editable) await save(true);
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function close() {
    if (!draft || !calc) return;
    if (calc.problems.length) return setStep(5);
    if (!confirm("¿Cerrar la inspección? Después no se puede editar, se recalcula el avance de la obra y se envían las alertas.")) return;
    if (!await save(true)) return;
    setSaving(true); setServerProblems([]);
    const response = await fetch(`/api/works/${workId}/inspections/${inspectionId}/close`, { method: "POST" });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) { setServerProblems(result.problems || []); return setError(result.error || "No se pudo cerrar la inspección"); }
    await load();
    setMessage(result.progress?.mode === "inspecciones" ? `Inspección cerrada. Avance de la obra: ${result.progress.progress}%.` : "Inspección cerrada. La obra no tiene base de avance: el porcentaje no se movió.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function discard() {
    if (!confirm("¿Descartar este borrador? Se pierde lo cargado.")) return;
    const response = await fetch(`/api/works/${workId}/inspections/${inspectionId}`, { method: "DELETE" });
    if (!response.ok) return setError((await response.json()).error || "No se pudo descartar");
    setDirty(false);
    router.push(`/app/works/${workId}`);
  }

  if (!loaded || !draft || !calc) return <div className="loading-state">{error || "Cargando inspección…"}</div>;
  const { work, context } = loaded;
  const template = inspectionTemplates[draft.rubro];

  return <>
    <Link href={`/app/works/${workId}`} className="back-link"><ArrowLeft /> Volver a la obra</Link>
    <div className="page-heading insp-heading">
      <div>
        <p className="eyebrow">INSPECCIÓN DE OBRA · {template.label.toUpperCase()}</p>
        <h1>{work.name}</h1>
        <p>{work.code}{work.clientName ? ` · ${work.clientName}` : ""}{work.address ? ` · ${work.address}` : ""}</p>
        <p className="insp-meta">
          <span><b>Día</b> {date(draft.dayKey)}</span>
          <span><b>Inicio de obra</b> {work.startDate ? date(work.startDate) : "—"}</span>
          <span><b>Cierre previsto</b> {work.endDate ? date(work.endDate) : "—"}</span>
        </p>
      </div>
      <div className="insp-heading-side">
        <span className={`badge ${draft.status === "cerrada" ? "terminada" : "pendiente"}`}>{optionLabels[draft.status]}</span>
        {calc.rubroPct !== null ? <span className="insp-big-pct" title="Avance del rubro con lo cargado hoy">{calc.rubroPct}%<small>{template.label}</small></span> : <span className="insp-big-pct empty">Sin base<small>de avance</small></span>}
      </div>
    </div>
    {message && <div className="notice success">{message}</div>}
    {error && <div className="notice error">{error}{serverProblems.length > 0 && <ul>{serverProblems.map(problem => <li key={problem}>{problem}</li>)}</ul>}</div>}

    {!editable
      ? <ClosedView draft={draft} calc={calc} context={context} />
      : <div className="insp-layout">
        <nav className="insp-steps" aria-label="Pasos de la inspección">
          {STEPS.map((item, index) => {
            const Icon = item.icon;
            const done = calc.stepDone[index];
            return <button key={item.title} type="button" className={`${index === step ? "active" : ""} ${done ? "done" : ""}`} aria-current={index === step ? "step" : undefined} onClick={() => { void goTo(index); }}>
              <i>{done ? <Check size={14} /> : index + 1}</i><Icon size={16} /><span>{item.title}</span>
            </button>;
          })}
        </nav>
        <section className="panel insp-card">
          <header className="insp-card-head"><p className="eyebrow">PASO {step + 1} DE {STEPS.length}</p><h2>{STEPS[step].title}</h2></header>
          <div className="insp-card-body">
            {step === 0 && <StepDay draft={draft} change={change} />}
            {step === 1 && <StepStaff draft={draft} change={change} context={context} calc={calc} workId={workId} />}
            {step === 2 && <StepChecks kind="quality" draft={draft} change={change} />}
            {step === 3 && <StepMaterials draft={draft} change={change} context={context} calc={calc} />}
            {step === 4 && <StepChecks kind="safety" draft={draft} change={change} />}
            {step === 5 && <StepReview draft={draft} change={change} calc={calc} />}
          </div>
          <footer className="insp-card-foot">
            <button type="button" className="secondary-btn danger-text" onClick={() => { void discard(); }}><Trash2 size={16} /> Descartar</button>
            <span>{saving ? "Guardando…" : dirty ? "Hay cambios sin guardar" : "Todo guardado"}</span>
            <button type="button" className="secondary-btn" disabled={step === 0} onClick={() => { void goTo(step - 1); }}><ArrowLeft size={16} /> Anterior</button>
            <button type="button" className="secondary-btn" disabled={saving || !dirty} onClick={() => { void save(); }}><Save size={16} /> Guardar borrador</button>
            {step < STEPS.length - 1
              ? <button type="button" className="primary-btn" onClick={() => { void goTo(step + 1); }}>Siguiente <ArrowRight size={16} /></button>
              : <button type="button" className="primary-btn" disabled={saving || calc.problems.length > 0} onClick={() => { void close(); }}><Lock size={16} /> Cerrar inspección</button>}
          </footer>
        </section>
      </div>}
  </>;
}

/* ─── Cuentas ──────────────────────────────────────────────────────────────── */

type Calc = {
  production: Array<ProductionRow & { previousQty: number; accumulatedQty: number; progressPct: number | null }>;
  rubroPct: number | null;
  material: MaterialControl | null;
  materialPrevious: { consumption: number; received: number };
  receivedMatching: number;
  problems: string[];
  alerts: InspectionAlert[];
  stepDone: boolean[];
  staffFromPartes: boolean;
};

function liveCalculations(draft: Inspection, context: Context): Calc {
  const production = draft.production.map(row => {
    const previousQty = row.lineId ? Number(context.previousByLine[row.lineId] || 0) : 0;
    const accumulatedQty = Math.round((previousQty + (Number(row.todayQty) || 0)) * 100) / 100;
    return { ...row, previousQty, accumulatedQty, progressPct: row.lineId ? lineProgress(row.plannedQty, accumulatedQty) : null };
  });
  const rubroLines = context.progress.lines.filter(line => line.rubro === draft.rubro);
  const accumulated = Object.fromEntries(production.filter(row => row.lineId).map(row => [row.lineId as string, row.accumulatedQty - (Number(rubroLines.find(line => line._id === row.lineId)?.initialQty) || 0)]));
  const rubroPct = draft.status === "cerrada" && draft.rubroProgressPct !== undefined ? draft.rubroProgressPct ?? null : computeWorkProgress(rubroLines, accumulated).byRubro[draft.rubro] ?? null;

  const main = draft.mainMaterial || {};
  const previous = context.previousMaterial;
  const same = Boolean(main.name) && normalized(previous?.name) === normalized(main.name);
  const materialPrevious = { consumption: same ? Number(previous?.consumptionAccumulated) || 0 : 0, received: same ? Number(previous?.receivedAccumulated) || 0 : 0 };
  const material = draft.status === "cerrada"
    ? (main.name ? { consumptionToday: Number(main.consumptionToday) || 0, consumptionAccumulated: Number(main.consumptionAccumulated) || 0, receivedAccumulated: Number(main.receivedAccumulated) || 0, remaining: main.remaining ?? null, consumptionPct: main.consumptionPct ?? null, enough: main.enough ?? null, deviation: main.deviation ?? null } : null)
    : main.name ? materialControl({ ...main, previousConsumption: materialPrevious.consumption, receivedPrevious: materialPrevious.received }, rubroPct) : null;
  const receivedMatching = draft.materialsReceived.filter(row => (main.stockItemId && row.stockItemId === main.stockItemId) || (main.name && normalized(row.name) === normalized(main.name))).reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);

  const asDraft = { ...draft, production } as unknown as InspectionDraft;
  const problems = closeProblems(asDraft);
  const alerts = inspectionAlerts(asDraft, material);
  const shortages = draft.shortages.filter(row => row.material.trim());
  const stepDone = [
    Boolean(draft.managerName.trim() && draft.weather),
    production.every(row => row.todayQty !== undefined && row.todayQty !== null) && (draft.performance !== "bajo" || Boolean(draft.lowPerformanceReason.trim())),
    draft.quality.every(point => point.result),
    shortages.every(row => row.quantity > 0) && (!shortages.length || Boolean(draft.shortageNeededBy)),
    draft.safety.every(point => point.result),
    problems.length === 0,
  ];
  return { production, rubroPct, material, materialPrevious, receivedMatching, problems, alerts, stepDone, staffFromPartes: context.staff.people.length > 0 };
}

/* ─── Pasos ────────────────────────────────────────────────────────────────── */

type StepProps = { draft: Inspection; change: (patch: Partial<Inspection>) => void };

function StepDay({ draft, change }: StepProps) {
  return <div className="insp-form-grid">
    <label className="insp-field"><span>Encargado *</span><input value={draft.managerName} maxLength={120} onChange={event => change({ managerName: event.target.value })} placeholder="Quién está a cargo en obra" /></label>
    <label className="insp-field"><span>Responsable de calidad</span><input value={draft.qualityResponsibleName} maxLength={120} onChange={event => change({ qualityResponsibleName: event.target.value })} placeholder="Quién controla" /></label>
    <div className="insp-field wide"><span>Clima *</span><Segmented value={draft.weather} options={WEATHER} onChange={weather => change({ weather })} /></div>
    <label className="insp-field wide"><span>Notas del día</span><textarea value={draft.notes} maxLength={5000} onChange={event => change({ notes: event.target.value })} placeholder="Algo del día que no entre en otro paso" /></label>
  </div>;
}

function StepStaff({ draft, change, context, calc, workId }: StepProps & { context: Context; calc: Calc; workId: string }) {
  const staff = draft.staff;
  const fromPartes = calc.staffFromPartes;
  const shown = fromPartes ? context.staff : staff;
  const total = shown.oficiales + shown.medioOficiales + shown.ayudantes + shown.otros;
  const setStaff = (patch: Partial<Staff>) => change({ staff: { ...staff, ...patch, source: fromPartes ? "partes" : "manual" } });
  const template = inspectionTemplates[draft.rubro];
  return <div className="insp-sections">
    <fieldset className="insp-fieldset">
      <legend>Personal</legend>
      {fromPartes
        ? <p className="insp-hint"><Users size={15} /> Sale de los partes diarios cargados para el {date(draft.dayKey)}. Para corregirlo, <Link href={`/app/works/${workId}#personal`}>editá los partes de la obra</Link>.</p>
        : <p className="insp-hint warn"><TriangleAlert size={15} /> No hay partes diarios cargados para este día: cargá el personal a mano o <Link href={`/app/works/${workId}#personal`}>cargá los partes</Link>.</p>}
      <div className="insp-counters">
        <Counter label="Oficiales" value={shown.oficiales} readOnly={fromPartes} onChange={oficiales => setStaff({ oficiales })} />
        <Counter label="Medio oficial" value={shown.medioOficiales} readOnly={fromPartes} onChange={medioOficiales => setStaff({ medioOficiales })} />
        <Counter label="Ayudantes" value={shown.ayudantes} readOnly={fromPartes} onChange={ayudantes => setStaff({ ayudantes })} />
        <Counter label="Otros" value={shown.otros} readOnly={fromPartes} onChange={otros => setStaff({ otros })} />
        <div className="insp-counter total"><span>Total operarios</span><b>{total}</b></div>
        <label className="insp-counter"><span>Horas trabajadas</span>{fromPartes ? <b>{qty(context.staff.hoursWorked)}</b> : <QtyInput value={staff.hoursWorked} onChange={value => setStaff({ hoursWorked: value ?? 0 })} />}</label>
        <label className="insp-counter"><span>Ingreso</span><input type="time" value={staff.checkIn || ""} onChange={event => change({ staff: { ...staff, checkIn: event.target.value } })} /></label>
        <label className="insp-counter"><span>Egreso</span><input type="time" value={staff.checkOut || ""} onChange={event => change({ staff: { ...staff, checkOut: event.target.value } })} /></label>
      </div>
      {fromPartes && <div className="insp-people">{context.staff.people.map(person => <span key={person.name}>{person.name}{person.category ? ` · ${titleCase(person.category)}` : ""} · {qty(person.hours)} h</span>)}</div>}
    </fieldset>

    <fieldset className="insp-fieldset">
      <legend>Producción del día</legend>
      {calc.production.some(row => !row.lineId) && <p className="insp-hint warn"><TriangleAlert size={15} /> Esta obra no tiene base de avance para {template.label.toLowerCase()}: la producción queda registrada pero no mueve el porcentaje. Cargá las cantidades previstas desde la obra.</p>}
      <div className="insp-production">
        {calc.production.map((row, index) => <div className="insp-production-row" key={row.lineId || `free-${index}`}>
          <div className="insp-production-title">
            {row.lineId ? <b>{row.label}</b> : <input value={row.label} maxLength={160} onChange={event => change({ production: draft.production.map((item, position) => position === index ? { ...item, label: event.target.value } : item) })} aria-label="Qué se produjo" />}
            {row.lineId ? <small>Prevista total: {qty(row.plannedQty)} {row.unit}</small> : <label className="insp-inline-unit"><small>Unidad</small><input value={row.unit} maxLength={20} onChange={event => change({ production: draft.production.map((item, position) => position === index ? { ...item, unit: event.target.value } : item) })} /></label>}
          </div>
          <div className="insp-production-numbers">
            <div><small>Acumulada hasta ayer</small><b>{row.lineId ? `${qty(row.previousQty)} ${row.unit}` : "—"}</b></div>
            <label><small>Realizada HOY *</small><QtyInput value={row.todayQty ?? undefined} suffix={row.unit} onChange={value => change({ production: draft.production.map((item, position) => position === index ? { ...item, todayQty: value ?? null } : item) })} /></label>
            <div><small>Acumulada total</small><b>{row.lineId ? `${qty(row.accumulatedQty)} ${row.unit}` : "—"}</b></div>
            <div><small>Avance</small>{row.progressPct !== null ? <ProgressBar value={row.progressPct} /> : <b className="muted">Sin base</b>}</div>
          </div>
        </div>)}
      </div>
    </fieldset>

    <fieldset className="insp-fieldset">
      <legend>Rendimiento</legend>
      <div className="insp-form-grid">
        <label className="insp-field"><span>Etapa del día</span><input list={`stages-${draft.rubro}`} value={draft.stage} maxLength={160} onChange={event => change({ stage: event.target.value })} placeholder={template.stages[0] || "Qué se hizo"} />
          <datalist id={`stages-${draft.rubro}`}>{template.stages.map(stage => <option key={stage} value={stage} />)}</datalist></label>
        <div className="insp-field"><span>Observación de rendimiento</span><Segmented value={draft.performance} options={PERFORMANCE} onChange={performance => change({ performance })} /></div>
        {draft.performance === "bajo" && <label className="insp-field wide"><span>Motivo del rendimiento bajo *</span><input value={draft.lowPerformanceReason} maxLength={500} onChange={event => change({ lowPerformanceReason: event.target.value })} placeholder="Lluvia, falta de material, menos gente…" /></label>}
        <div className="insp-field wide"><span>Relación producción / consumo</span><Segmented value={draft.productionConsumption} options={PRODUCTION_CONSUMPTION} onChange={productionConsumption => change({ productionConsumption })} /></div>
      </div>
    </fieldset>

    {template.colors && <ColorsEditor draft={draft} change={change} />}
    <PhotosEditor draft={draft} change={change} />
  </div>;
}

function StepChecks({ kind, draft, change }: StepProps & { kind: "quality" | "safety" }) {
  const points = draft[kind];
  const set = (key: string, patch: Partial<Check>) => change({ [kind]: points.map(point => point.key === key ? { ...point, ...patch } : point) } as Partial<Inspection>);
  const answered = points.filter(point => point.result).length;
  return <div className="insp-sections">
    <div className="insp-check-head"><span>{answered} de {points.length} controlados</span>
      <button type="button" className="link-btn" onClick={() => change({ [kind]: points.map(point => point.result ? point : { ...point, result: "cumple" }) } as Partial<Inspection>)}><CheckCircle2 size={14} /> Marcar los pendientes como “Cumple”</button>
    </div>
    <div className="insp-checks">{points.map((point, index) => <div className={`insp-check ${point.result}`} key={point.key}>
      <p><i>{index + 1}</i>{point.label}</p>
      <Segmented value={point.result} options={CHECK_RESULTS} onChange={result => set(point.key, { result })} tone />
      {(point.result === "no_cumple" || point.notes) && <input className="insp-check-notes" value={point.notes} maxLength={500} placeholder={point.result === "no_cumple" ? "Qué no cumple y qué se hace" : "Observaciones"} onChange={event => set(point.key, { notes: event.target.value })} />}
      {point.result !== "no_cumple" && !point.notes && <button type="button" className="link-btn insp-add-note" onClick={() => set(point.key, { notes: " " })}><Plus size={13} /> Observación</button>}
    </div>)}</div>
    {kind === "quality"
      ? <label className="insp-field wide"><span>Observaciones generales de calidad</span><textarea value={draft.qualityNotes} maxLength={5000} onChange={event => change({ qualityNotes: event.target.value })} /></label>
      : <label className="insp-field wide"><span>Incidentes / riesgos detectados</span><textarea value={draft.incidents} maxLength={5000} onChange={event => change({ incidents: event.target.value })} placeholder="Si no hubo, dejalo vacío" /></label>}
  </div>;
}

function StepMaterials({ draft, change, context, calc }: StepProps & { context: Context; calc: Calc }) {
  const main = draft.mainMaterial || {};
  const setMain = (patch: Partial<MainMaterial>) => change({ mainMaterial: { ...main, ...patch } });
  const received = draft.materialsReceived;
  const setReceived = (index: number, patch: Partial<Received>) => change({ materialsReceived: received.map((row, position) => position === index ? { ...row, ...patch } : row) });
  const missingDeliveries = context.deliveries.filter(delivery => !received.some(row => row.movementId === delivery.movementId));
  const shortages = draft.shortages;
  const setShortage = (index: number, patch: Partial<Shortage>) => change({ shortages: shortages.map((row, position) => position === index ? { ...row, ...patch } : row) });
  const material = calc.material;
  return <div className="insp-sections">
    <fieldset className="insp-fieldset">
      <legend>Materiales recibidos hoy</legend>
      <p className="insp-hint"><Package size={15} /> Lo entregado desde Stock a esta obra ese día aparece solo. Agregá lo que llegó por fuera del depósito.</p>
      {missingDeliveries.length > 0 && <button type="button" className="link-btn" onClick={() => change({ materialsReceived: [...received, ...missingDeliveries.map(delivery => ({ source: "stock" as const, ...delivery, condition: "ok", notes: "" }))] })}><Plus size={14} /> Sumar {missingDeliveries.length} entrega(s) de Stock</button>}
      <div className="insp-table">
        <div className="insp-table-head"><span>Material</span><span>Cantidad</span><span>Estado</span><span>Observaciones</span><span /></div>
        {received.map((row, index) => <div className="insp-table-row" key={row.movementId || `manual-${index}`}>
          <span data-label="Material">{row.source === "stock" ? <b>{row.name} <em className="insp-tag">Stock</em></b> : <input value={row.name} maxLength={160} placeholder="Material" onChange={event => setReceived(index, { name: event.target.value })} />}</span>
          <span data-label="Cantidad">{row.source === "stock" ? <b>{qty(row.quantity)} {row.unit}</b> : <QtyInput value={row.quantity} suffix={row.unit} onChange={value => setReceived(index, { quantity: value ?? 0 })} />}</span>
          <span data-label="Estado"><Segmented value={row.condition} options={MATERIAL_CONDITIONS} onChange={condition => setReceived(index, { condition })} tone /></span>
          <span data-label="Observaciones"><input value={row.notes} maxLength={500} onChange={event => setReceived(index, { notes: event.target.value })} /></span>
          <span><button type="button" className="check-delete" aria-label="Quitar" onClick={() => change({ materialsReceived: received.filter((_, position) => position !== index) })}><Trash2 /></button></span>
        </div>)}
        {!received.length && <p className="insp-empty">No se registró material recibido.</p>}
      </div>
      <button type="button" className="secondary-btn insp-add" onClick={() => change({ materialsReceived: [...received, { source: "manual", name: "", unit: "", quantity: 0, condition: "ok", notes: "" }] })}><Plus size={15} /> Agregar material recibido</button>
    </fieldset>

    <fieldset className="insp-fieldset">
      <legend>Control y proyección del material principal</legend>
      <p className="insp-hint">El consumo se compara con el avance para detectar desvíos. Es un indicador: no cambia el avance de la obra.{context.previousMaterial ? ` Última inspección del rubro: ${date(context.previousMaterial.dayKey)}.` : ""}</p>
      <div className="insp-form-grid three">
        <label className="insp-field"><span>Material principal</span><input value={main.name || ""} maxLength={160} onChange={event => setMain({ name: event.target.value })} placeholder="Ej.: membrana, pintura látex" list="insp-received-names" />
          <datalist id="insp-received-names">{[...new Set(received.map(row => row.name).filter(Boolean))].map(name => <option key={name} value={name} />)}</datalist></label>
        <label className="insp-field"><span>Unidad</span><input value={main.unit || ""} maxLength={20} onChange={event => setMain({ unit: event.target.value })} placeholder="bolsas, tachos, kg, m²" /></label>
        <label className="insp-field"><span>Total previsto (obra)</span><QtyInput value={main.plannedQty} suffix={main.unit} onChange={plannedQty => setMain({ plannedQty })} /></label>
        <label className="insp-field"><span>Stock al inicio del día</span><QtyInput value={main.stockStart} suffix={main.unit} onChange={stockStart => setMain({ stockStart })} /></label>
        <label className="insp-field"><span>Recibido hoy</span><QtyInput value={main.receivedToday} suffix={main.unit} onChange={receivedToday => setMain({ receivedToday })} />
          {calc.receivedMatching > 0 && calc.receivedMatching !== main.receivedToday && <button type="button" className="link-btn" onClick={() => setMain({ receivedToday: calc.receivedMatching })}>Usar lo recibido ({qty(calc.receivedMatching)})</button>}</label>
        <label className="insp-field"><span>Stock al final del día</span><QtyInput value={main.stockEnd} suffix={main.unit} onChange={stockEnd => setMain({ stockEnd })} /></label>
      </div>
      {material && <div className="insp-kpis">
        <Kpi label="Consumo hoy" value={`${qty(material.consumptionToday)} ${main.unit || ""}`} />
        <Kpi label="Consumo acumulado" value={`${qty(material.consumptionAccumulated)} ${main.unit || ""}`} hint={`hasta ayer ${qty(calc.materialPrevious.consumption)}`} />
        <Kpi label="Recibido acumulado" value={`${qty(material.receivedAccumulated)} ${main.unit || ""}`} />
        <Kpi label="Material restante" value={material.remaining === null ? "—" : `${qty(material.remaining)} ${main.unit || ""}`} />
        <Kpi label="Consumido / avance" value={material.consumptionPct === null ? "—" : `${material.consumptionPct}% / ${calc.rubroPct ?? "—"}%`} />
        <Kpi label="¿Alcanza lo previsto?" value={material.enough === null ? "—" : material.enough ? "Sí" : "No"} tone={material.enough === false ? "bad" : material.enough ? "good" : undefined} />
        <Kpi wide label="Alerta de desvío" value={material.deviation ? deviationLabels[material.deviation] : "Sin datos para comparar"} tone={material.deviation === "acorde" ? "good" : material.deviation ? "bad" : undefined} />
      </div>}
      <label className="insp-field wide"><span>Observación</span><input value={main.notes || ""} maxLength={500} onChange={event => setMain({ notes: event.target.value })} /></label>
    </fieldset>

    <fieldset className="insp-fieldset">
      <legend>Faltantes / ajustes necesarios</legend>
      <div className="insp-table shortages">
        <div className="insp-table-head"><span>Material</span><span>Cantidad</span><span>Unidad</span><span /></div>
        {shortages.map((row, index) => <div className="insp-table-row" key={index}>
          <span data-label="Material"><input value={row.material} maxLength={160} placeholder="Material" onChange={event => setShortage(index, { material: event.target.value })} /></span>
          <span data-label="Cantidad"><QtyInput value={row.quantity} onChange={value => setShortage(index, { quantity: value ?? 0 })} /></span>
          <span data-label="Unidad"><input value={row.unit} maxLength={20} onChange={event => setShortage(index, { unit: event.target.value })} /></span>
          <span><button type="button" className="check-delete" aria-label="Quitar faltante" onClick={() => change({ shortages: shortages.filter((_, position) => position !== index) })}><Trash2 /></button></span>
        </div>)}
        {!shortages.length && <p className="insp-empty">Sin faltantes.</p>}
      </div>
      <button type="button" className="secondary-btn insp-add" onClick={() => change({ shortages: [...shortages, { material: "", quantity: 0, unit: "" }] })}><Plus size={15} /> Agregar faltante</button>
      {shortages.length > 0 && <div className="insp-form-grid">
        <label className="insp-field"><span>Fecha necesaria *</span><DateInput name="shortageNeededBy" defaultValue={draft.shortageNeededBy ? String(draft.shortageNeededBy).slice(0, 10) : ""} onValueChange={iso => change({ shortageNeededBy: iso || undefined })} quickRanges={[1, 3, 7]} /></label>
        <div className="insp-field"><span>Estado del pedido</span><Segmented value={draft.shortageOrderStatus} options={ORDER_STATUS} onChange={shortageOrderStatus => change({ shortageOrderStatus })} /></div>
      </div>}
      {shortages.length > 0 && <p className="insp-hint"><TriangleAlert size={15} /> Al cerrar, Compras recibe el aviso de los faltantes.</p>}
    </fieldset>
  </div>;
}

function StepReview({ draft, change, calc }: StepProps & { calc: Calc }) {
  return <div className="insp-sections">
    {calc.problems.length > 0
      ? <div className="insp-problems"><b><TriangleAlert size={16} /> Falta completar para cerrar</b><ul>{calc.problems.map(problem => <li key={problem}>{problem}</li>)}</ul></div>
      : <div className="insp-ready"><CheckCircle2 size={18} /> Está todo cargado. Al cerrar se bloquea la edición, se recalcula el avance de la obra y se deja la entrada en el historial.</div>}
    <InspectionSummary draft={draft} calc={calc} />
    <div className="insp-field wide"><span>Fotos</span><PhotosEditor draft={draft} change={change} compact /></div>
  </div>;
}

/* ─── Vista de una inspección cerrada ──────────────────────────────────────── */

function ClosedView({ draft, calc, context }: { draft: Inspection; calc: Calc; context: Context }) {
  return <section className="panel insp-card">
    <header className="insp-card-head insp-closed-head">
      <div><p className="eyebrow">{draft.status === "cerrada" ? "INSPECCIÓN CERRADA" : "SOLO LECTURA"}</p>
        <h2>{rubroLabel(draft.rubro)} · {date(draft.dayKey)}</h2>
        {draft.closedAt && <small>Cerrada por {draft.closedByName} el {dateTime(draft.closedAt)}</small>}</div>
      {draft.workProgressPct !== undefined && draft.workProgressPct !== null && <div className="insp-closed-progress"><small>Avance de la obra al cerrar</small><ProgressBar value={draft.workProgressPct} /></div>}
    </header>
    <div className="insp-card-body insp-sections">
      <InspectionSummary draft={draft} calc={calc} context={context} full />
      {draft.photos.length > 0 && <div className="activity-photos count-3">{draft.photos.map((photo, index) => <a key={photo} href={photo} target="_blank" rel="noreferrer"><Image src={photo} alt={`Foto ${index + 1} de la inspección`} width={720} height={480} unoptimized /></a>)}</div>}
    </div>
  </section>;
}

function InspectionSummary({ draft, calc, full = false }: { draft: Inspection; calc: Calc; context?: Context; full?: boolean }) {
  const alerts = draft.status === "cerrada" ? draft.alerts : calc.alerts;
  const staff = draft.staff;
  const total = staff.oficiales + staff.medioOficiales + staff.ayudantes + staff.otros;
  const template = inspectionTemplates[draft.rubro];
  return <div className="insp-summary">
    <div className="insp-summary-block">
      <h3>{alerts.length ? <><TriangleAlert size={16} /> {alerts.length} alerta(s)</> : <><CheckCircle2 size={16} /> Sin alertas</>}</h3>
      {alerts.length > 0 && <ul className="insp-alerts">{alerts.map((alert, index) => <li key={index} className={alert.kind}><em>{titleCase(alert.kind)}</em>{alert.message}</li>)}</ul>}
    </div>
    <div className="insp-summary-grid">
      <SummaryItem label="Encargado" value={draft.managerName || "—"} />
      <SummaryItem label="Clima" value={optionLabels[draft.weather] || "—"} />
      <SummaryItem label="Responsable de calidad" value={draft.qualityResponsibleName || "—"} />
      <SummaryItem label="Operarios" value={`${total} · ${qty(staff.hoursWorked)} h${staff.source === "partes" ? " (partes)" : ""}`} />
      <SummaryItem label="Ingreso / egreso" value={`${staff.checkIn || "—"} / ${staff.checkOut || "—"}`} />
      <SummaryItem label="Etapa" value={draft.stage || "—"} />
      <SummaryItem label="Rendimiento" value={`${optionLabels[draft.performance] || "—"}${draft.performance === "bajo" ? `: ${draft.lowPerformanceReason}` : ""}`} />
      <SummaryItem label="Producción / consumo" value={optionLabels[draft.productionConsumption] || "—"} />
    </div>
    <div className="insp-summary-block">
      <h3><HardHat size={16} /> Producción</h3>
      {calc.production.map((row, index) => <div className="insp-summary-row" key={row.lineId || index}>
        <b>{row.label}</b><span>Hoy {qty(Number(row.todayQty) || 0)} {row.unit}{row.lineId ? ` · acumulado ${qty(row.accumulatedQty)} de ${qty(row.plannedQty)}` : " · sin base de avance"}</span>
        {row.progressPct !== null ? <ProgressBar value={row.progressPct} /> : <small>—</small>}
      </div>)}
    </div>
    <div className="insp-summary-block">
      <h3><ClipboardCheck size={16} /> Calidad y seguridad</h3>
      {[...draft.quality, ...draft.safety].filter(point => full || point.result === "no_cumple" || point.notes.trim()).map(point => <div className={`insp-summary-row check ${point.result}`} key={`${point.key}-${point.label}`}>
        <span>{point.label}{point.notes.trim() ? <small> — {point.notes}</small> : null}</span><em>{optionLabels[point.result] || "Sin controlar"}</em>
      </div>)}
      {!full && <small className="insp-muted">Se listan los incumplimientos y los puntos con observaciones. {draft.quality.filter(point => point.result === "cumple").length + draft.safety.filter(point => point.result === "cumple").length} puntos cumplen.</small>}
      {draft.qualityNotes && <p className="insp-note"><b>Calidad:</b> {draft.qualityNotes}</p>}
      {draft.incidents && <p className="insp-note bad"><b>Incidentes / riesgos:</b> {draft.incidents}</p>}
    </div>
    <div className="insp-summary-block">
      <h3><Package size={16} /> Materiales</h3>
      {draft.materialsReceived.length ? draft.materialsReceived.map((row, index) => <div className="insp-summary-row" key={index}><b>{row.name}</b><span>{qty(row.quantity)} {row.unit}{row.source === "stock" ? " · desde Stock" : ""}{row.notes ? ` · ${row.notes}` : ""}</span><em className={row.condition}>{optionLabels[row.condition] || "—"}</em></div>) : <small className="insp-muted">Sin material recibido.</small>}
      {draft.mainMaterial?.name && calc.material && <p className="insp-note">{draft.mainMaterial.name}: consumo hoy {qty(calc.material.consumptionToday)}, acumulado {qty(calc.material.consumptionAccumulated)}{calc.material.remaining !== null ? `, restan ${qty(calc.material.remaining)}` : ""} {draft.mainMaterial.unit}. {calc.material.deviation ? deviationLabels[calc.material.deviation] : ""}</p>}
      {draft.shortages.filter(row => row.material.trim()).length > 0 && <p className="insp-note bad"><b>Faltantes:</b> {draft.shortages.filter(row => row.material.trim()).map(row => `${row.material} ${qty(row.quantity)} ${row.unit}`).join(", ")}{draft.shortageNeededBy ? ` · para el ${date(draft.shortageNeededBy)}` : ""} · {optionLabels[draft.shortageOrderStatus] || "sin estado de pedido"}</p>}
    </div>
    {template.colors && draft.colors.length > 0 && <div className="insp-summary-block">
      <h3><Palette size={16} /> Distribución de colores</h3>
      {draft.colors.map((row, index) => <div className="insp-summary-row" key={index}><b>{row.sector}</b><span>{[row.color, row.paintType, row.brand, row.notes].filter(Boolean).join(" · ")}</span></div>)}
    </div>}
    {draft.notes && <p className="insp-note"><b>Notas:</b> {draft.notes}</p>}
  </div>;
}

/* ─── Piezas ───────────────────────────────────────────────────────────────── */

function ColorsEditor({ draft, change }: StepProps) {
  const colors = draft.colors;
  const set = (index: number, patch: Partial<ColorRow>) => change({ colors: colors.map((row, position) => position === index ? { ...row, ...patch } : row) });
  return <fieldset className="insp-fieldset">
    <legend>Distribución de colores</legend>
    <div className="insp-table colors">
      <div className="insp-table-head"><span>Sector</span><span>Color</span><span>Tipo de pintura</span><span>Marca</span><span>Observaciones</span><span /></div>
      {colors.map((row, index) => <div className="insp-table-row" key={index}>
        <span data-label="Sector"><input list="insp-color-sectors" value={row.sector} maxLength={80} onChange={event => set(index, { sector: event.target.value })} /></span>
        <span data-label="Color"><input value={row.color} maxLength={120} onChange={event => set(index, { color: event.target.value })} /></span>
        <span data-label="Tipo"><input value={row.paintType} maxLength={120} onChange={event => set(index, { paintType: event.target.value })} /></span>
        <span data-label="Marca"><input value={row.brand} maxLength={120} onChange={event => set(index, { brand: event.target.value })} /></span>
        <span data-label="Observaciones"><input value={row.notes} maxLength={300} onChange={event => set(index, { notes: event.target.value })} /></span>
        <span><button type="button" className="check-delete" aria-label="Quitar sector" onClick={() => change({ colors: colors.filter((_, position) => position !== index) })}><Trash2 /></button></span>
      </div>)}
      {!colors.length && <p className="insp-empty">Sin sectores cargados.</p>}
    </div>
    <datalist id="insp-color-sectors">{COLOR_SECTORS.map(sector => <option key={sector} value={sector} />)}</datalist>
    <button type="button" className="secondary-btn insp-add" onClick={() => change({ colors: [...colors, { sector: COLOR_SECTORS[colors.length] || "", color: "", paintType: "", brand: "", notes: "" }] })}><Plus size={15} /> Agregar sector</button>
  </fieldset>;
}

function PhotosEditor({ draft, change, compact = false }: StepProps & { compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(files: FileList | null) {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (draft.photos.length + list.length > 12) return setError("Hasta 12 fotos por inspección");
    setBusy(true); setError("");
    try {
      const paths = await Promise.all(list.map(async file => {
        const form = new FormData(); form.set("file", file);
        const response = await fetch("/api/uploads", { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `No se pudo subir ${file.name}`);
        return String(result.path);
      }));
      change({ photos: [...draft.photos, ...paths] });
    } catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudieron subir las fotos"); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  const content = <>
    <div className="insp-photos">
      {draft.photos.map((photo, index) => <figure key={photo}><Image src={photo} alt={`Foto ${index + 1}`} width={240} height={160} unoptimized /><button type="button" aria-label="Quitar foto" onClick={() => change({ photos: draft.photos.filter(item => item !== photo) })}><X size={14} /></button></figure>)}
      <label className="photo-picker insp-photo-add"><ImagePlus /> {busy ? "Subiendo…" : "Agregar fotos"}<input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={event => { void upload(event.target.files); }} /></label>
    </div>
    {error && <p className="form-error">{error}</p>}
  </>;
  return compact ? content : <fieldset className="insp-fieldset"><legend>Fotos</legend>{content}</fieldset>;
}

function Segmented<T extends string>({ value, options, onChange, tone = false }: { value: string; options: readonly T[]; onChange: (value: T) => void; tone?: boolean }) {
  return <div className={`insp-segmented${tone ? " tone" : ""}`} role="radiogroup">
    {options.map(option => <button key={option} type="button" role="radio" aria-checked={value === option} className={`${value === option ? "active" : ""} ${option}`} onClick={() => onChange(option)}>{optionLabels[option] || titleCase(option)}</button>)}
  </div>;
}

function Counter({ label, value, readOnly, onChange }: { label: string; value: number; readOnly: boolean; onChange: (value: number) => void }) {
  return <div className="insp-counter">
    <span>{label}</span>
    {readOnly ? <b>{value}</b> : <div className="insp-stepper">
      <button type="button" aria-label={`Restar ${label}`} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <b>{value}</b>
      <button type="button" aria-label={`Sumar ${label}`} onClick={() => onChange(value + 1)}>+</button>
    </div>}
  </div>;
}

/** Cantidad con coma decimal. Vacío es "no cargado", que no es lo mismo que cero. */
function QtyInput({ value, onChange, suffix }: { value?: number | null; onChange: (value: number | undefined) => void; suffix?: string }) {
  const [text, setText] = useState(() => qtyText(value));
  const [seen, setSeen] = useState(value);
  // Si el valor cambia desde afuera (el botón "usar lo recibido"), se refleja sin pisar lo que se está tipeando.
  if (seen !== value) {
    setSeen(value);
    if ((value ?? undefined) !== parseQty(text)) setText(qtyText(value));
  }
  return <span className="insp-qty">
    <input inputMode="decimal" autoComplete="off" value={text} placeholder="—" onChange={event => {
      const next = event.target.value.replace(/[^\d.,]/g, "");
      setText(next);
      const number = parseQty(next);
      if (number === undefined || Number.isFinite(number)) onChange(number);
    }} />
    {suffix ? <small>{suffix}</small> : null}
  </span>;
}

// En obra se tipea con coma o con punto: los dos son decimales. No hay separador de miles.
function parseQty(text: string) { return text.trim() === "" ? undefined : Number(text.replace(",", ".")); }
function qtyText(value?: number | null) { return value === undefined || value === null ? "" : String(value).replace(".", ","); }

function ProgressBar({ value }: { value: number }) {
  return <span className="insp-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}><i style={{ width: `${Math.min(100, value)}%` }} /><b>{value}%</b></span>;
}

function Kpi({ label, value, hint, tone, wide }: { label: string; value: string; hint?: string; tone?: "good" | "bad"; wide?: boolean }) {
  return <div className={`insp-kpi ${tone || ""} ${wide ? "wide" : ""}`}><span>{label}</span><b>{value}</b>{hint && <small>{hint}</small>}</div>;
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><b>{value}</b></div>;
}

/* ─── Ida y vuelta con la API ──────────────────────────────────────────────── */

function normalize(raw: Inspection): Inspection {
  const text = (value: unknown) => typeof value === "string" ? value : "";
  const staff = (raw.staff || {}) as Partial<Staff>;
  return {
    ...raw,
    managerName: text(raw.managerName), weather: text(raw.weather), qualityResponsibleName: text(raw.qualityResponsibleName),
    staff: { source: staff.source === "manual" ? "manual" : "partes", oficiales: Number(staff.oficiales) || 0, medioOficiales: Number(staff.medioOficiales) || 0, ayudantes: Number(staff.ayudantes) || 0, otros: Number(staff.otros) || 0, hoursWorked: Number(staff.hoursWorked) || 0, checkIn: text(staff.checkIn), checkOut: text(staff.checkOut), people: staff.people || [] },
    production: (raw.production || []).map(row => ({ ...row, lineId: row.lineId ? String(row.lineId) : undefined, label: text(row.label), unit: text(row.unit), plannedQty: Number(row.plannedQty) || 0, todayQty: row.todayQty === null || row.todayQty === undefined ? undefined : Number(row.todayQty) })),
    stage: text(raw.stage), performance: text(raw.performance), lowPerformanceReason: text(raw.lowPerformanceReason), productionConsumption: text(raw.productionConsumption),
    quality: (raw.quality || []).map(point => ({ key: point.key, label: point.label, result: text(point.result), notes: text(point.notes) })),
    qualityNotes: text(raw.qualityNotes),
    materialsReceived: (raw.materialsReceived || []).map(row => ({ ...row, stockItemId: row.stockItemId ? String(row.stockItemId) : undefined, movementId: row.movementId ? String(row.movementId) : undefined, name: text(row.name), unit: text(row.unit), quantity: Number(row.quantity) || 0, condition: text(row.condition), notes: text(row.notes) })),
    mainMaterial: { ...(raw.mainMaterial || {}), stockItemId: raw.mainMaterial?.stockItemId ? String(raw.mainMaterial.stockItemId) : undefined },
    shortages: (raw.shortages || []).map(row => ({ material: text(row.material), quantity: Number(row.quantity) || 0, unit: text(row.unit) })),
    shortageOrderStatus: text(raw.shortageOrderStatus),
    safety: (raw.safety || []).map(point => ({ key: point.key, label: point.label, result: text(point.result), notes: text(point.notes) })),
    incidents: text(raw.incidents),
    colors: (raw.colors || []).map(row => ({ sector: text(row.sector), color: text(row.color), paintType: text(row.paintType), brand: text(row.brand), notes: text(row.notes) })),
    photos: raw.photos || [], notes: text(raw.notes), alerts: raw.alerts || [],
  };
}

function payload(draft: Inspection) {
  const main = draft.mainMaterial || {};
  const blank = (value?: number | null) => value === undefined || value === null ? "" : value;
  return {
    managerName: draft.managerName, weather: draft.weather, qualityResponsibleName: draft.qualityResponsibleName,
    staff: { source: draft.staff.source, oficiales: draft.staff.oficiales, medioOficiales: draft.staff.medioOficiales, ayudantes: draft.staff.ayudantes, otros: draft.staff.otros, hoursWorked: draft.staff.hoursWorked, checkIn: draft.staff.checkIn || "", checkOut: draft.staff.checkOut || "" },
    production: draft.production.map(row => ({ lineId: row.lineId || "", label: row.label, unit: row.unit, todayQty: blank(row.todayQty) })),
    stage: draft.stage, performance: draft.performance, lowPerformanceReason: draft.lowPerformanceReason, productionConsumption: draft.productionConsumption,
    quality: draft.quality.map(point => ({ key: point.key, label: point.label, result: point.result, notes: point.notes.trim() })),
    qualityNotes: draft.qualityNotes,
    materialsReceived: draft.materialsReceived.filter(row => row.name.trim()).map(row => ({ source: row.source, stockItemId: row.stockItemId || "", movementId: row.movementId || "", name: row.name, unit: row.unit, quantity: row.quantity, condition: row.condition, notes: row.notes })),
    mainMaterial: { stockItemId: main.stockItemId || "", name: main.name || "", unit: main.unit || "", plannedQty: blank(main.plannedQty), stockStart: blank(main.stockStart), receivedToday: blank(main.receivedToday), stockEnd: blank(main.stockEnd), notes: main.notes || "" },
    shortages: draft.shortages.filter(row => row.material.trim()),
    shortageNeededBy: draft.shortageNeededBy ? String(draft.shortageNeededBy).slice(0, 10) : "",
    shortageOrderStatus: draft.shortageOrderStatus,
    safety: draft.safety.map(point => ({ key: point.key, label: point.label, result: point.result, notes: point.notes.trim() })),
    incidents: draft.incidents,
    colors: draft.colors.filter(row => row.sector.trim() || row.color.trim()),
    photos: draft.photos, notes: draft.notes,
  };
}
