"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ClipboardCheck, FileCheck2, ImagePlus, MessageSquareText, Plus, Send, Timer, Trash2, Users } from "lucide-react";
import { date, dateTime, money } from "@/lib/format";

type Checklist = { _id: string; title: string; done: boolean; completedAt?: string; createdAt?: string; updatedAt?: string };
type Activity = { _id: string; detail: string; photos: string[]; authorName: string; createdAt: string };
type Advance = { percentage: number; note: string; date: string };
type Certificate = { number: string; period: string; percentage: number; amountCents: number; approved: boolean; invoiced: boolean };
type Labor = { person: string; date: string; hours: number; costCents: number };
type Work = { _id: string; name: string; code: string; progress: number; createdAt?: string; updatedAt?: string; checklist: Checklist[]; activity: Activity[]; advances: Advance[]; certificates: Certificate[]; labor: Labor[] };

export function WorkDetail({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [work, setWork] = useState<Work | null>(null);
  const [error, setError] = useState("");
  const [checklistBusy, setChecklistBusy] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/records/works/${id}`);
    const result = await response.json();
    if (response.ok && rGuard(result)) { setWork(result); setError(""); }
    else setError(result.error || "No se pudo cargar la obra");
  }, [id]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function patch(body: Partial<Work>) {
    const response = await fetch(`/api/records/works/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) { setError(result.error || "No se pudo guardar"); return false; }
    await load();
    return true;
  }

  async function addChecklist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(new FormData(form).get("title") || "").trim();
    if (!title) return;
    setChecklistBusy("new");
    const response = await fetch(`/api/works/${id}/checklist`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
    const result = await response.json();
    if (!response.ok) setError(result.error || "No se pudo agregar la tarea");
    else { form.reset(); await load(); }
    setChecklistBusy("");
  }

  async function toggleChecklist(item: Checklist) {
    setChecklistBusy(item._id);
    const response = await fetch(`/api/works/${id}/checklist/${item._id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: !item.done }) });
    if (!response.ok) setError((await response.json()).error || "No se pudo actualizar la tarea");
    else await load();
    setChecklistBusy("");
  }

  async function removeChecklist(item: Checklist) {
    if (!confirm(`¿Eliminar “${item.title}” de la checklist?`)) return;
    setChecklistBusy(item._id);
    const response = await fetch(`/api/works/${id}/checklist/${item._id}`, { method: "DELETE" });
    if (!response.ok) setError((await response.json()).error || "No se pudo eliminar la tarea");
    else await load();
    setChecklistBusy("");
  }

  async function publishActivity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const detail = String(data.get("detail") || "").trim();
    const files = photoInput.current?.files ? Array.from(photoInput.current.files) : [];
    if (!detail) return setError("Escribí un detalle para el historial");
    if (files.length > 8) return setError("Podés adjuntar hasta 8 imágenes por actualización");
    setPublishing(true);
    setError("");
    try {
      const photos = await Promise.all(files.map(async file => {
        const upload = new FormData();
        upload.set("file", file);
        const response = await fetch("/api/uploads", { method: "POST", body: upload });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `No se pudo subir ${file.name}`);
        return String(result.path);
      }));
      const response = await fetch(`/api/works/${id}/activity`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ detail, photos }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo publicar la actualización");
      form.reset();
      setSelectedPhotos([]);
      await load();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudo publicar la actualización"); }
    finally { setPublishing(false); }
  }

  async function advance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!work) return;
    const form = event.currentTarget; const data = new FormData(form); const percentage = Number(data.get("percentage"));
    if (await patch({ progress: percentage, advances: [...(work.advances || []), { percentage, note: String(data.get("note")), date: String(data.get("date")) }] })) form.reset();
  }

  async function certificate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); let file = ""; const selected = data.get("file");
    if (selected instanceof File && selected.size) {
      const upload = new FormData(); upload.set("file", selected);
      const response = await fetch("/api/uploads", { method: "POST", body: upload }); const result = await response.json();
      if (!response.ok) return setError(result.error); file = result.path;
    }
    const response = await fetch(`/api/works/${id}/certificates`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number: data.get("number"), period: data.get("period"), percentage: Number(data.get("percentage")), amountCents: Math.round(Number(data.get("amount")) * 100), approved: true, file }) });
    if (!response.ok) setError((await response.json()).error); else { form.reset(); load(); }
  }

  async function labor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!work) return;
    const form = event.currentTarget; const data = new FormData(form);
    if (await patch({ labor: [...(work.labor || []), { person: String(data.get("person")), date: String(data.get("date")), hours: Number(data.get("hours")), costCents: Math.round(Number(data.get("cost")) * 100) }] })) form.reset();
  }

  if (!work) return <div className="loading-state">{error || "Cargando obra…"}</div>;
  const fallbackCreatedAt = work.createdAt;
  const fallbackUpdatedAt = work.updatedAt || work.createdAt;

  return <>
    <Link href="/app/works" className="back-link"><ArrowLeft/> Volver a obras</Link>
    <div className="page-heading work-heading"><div><p className="eyebrow">OBRA {work.code}</p><h1>{work.name}</h1><p>Avance actual: {work.progress}%</p></div><span className="work-progress-big" style={{ background: `conic-gradient(var(--brand-red) 0 ${work.progress}%, var(--brand-navy) ${work.progress}% 100%)` }}>{work.progress}%</span></div>
    {error && <div className="notice error">{error}</div>}

    <section className="panel work-timeline-section">
      <div className="panel-head"><div className="section-title"><MessageSquareText/><div><h2>Historial de obra</h2><p>Actualizaciones del equipo, ordenadas como un hilo.</p></div></div><span className="activity-count">{work.activity?.length || 0} entradas</span></div>
      {canEdit && <form className="activity-composer" onSubmit={publishActivity}>
        <span className="activity-avatar">+</span>
        <div className="activity-compose-body"><textarea name="detail" required maxLength={5000} placeholder="Contá qué se realizó, decisiones tomadas o próximos pasos…"/>{selectedPhotos.length > 0 && <div className="selected-photos">{selectedPhotos.map(name => <span key={name}>{name}</span>)}</div>}<div className="activity-compose-actions"><label className="photo-picker"><ImagePlus/> Adjuntar imágenes<input ref={photoInput} name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={event => setSelectedPhotos(Array.from(event.target.files || []).map(file => file.name))}/></label><small>JPG, PNG o WebP · hasta 8</small><button className="primary-btn" disabled={publishing}><Send/>{publishing ? "Publicando…" : "Publicar actualización"}</button></div></div>
      </form>}
      <div className="activity-thread">
        {work.activity?.slice().reverse().map(entry => <article className="activity-entry" key={entry._id}>
          <span className="activity-avatar">{initials(entry.authorName)}</span>
          <div className="activity-entry-body"><header><b>{entry.authorName}</b><time dateTime={entry.createdAt}>{dateTime(entry.createdAt)}</time></header><p>{entry.detail}</p>{entry.photos?.length > 0 && <div className={`activity-photos count-${Math.min(entry.photos.length, 4)}`}>{entry.photos.map((photo, index) => <a href={photo} target="_blank" rel="noreferrer" key={photo}><Image src={photo} alt={`Imagen ${index + 1} de la actualización de ${entry.authorName}`} width={720} height={480} unoptimized/></a>)}</div>}</div>
        </article>)}
        {!work.activity?.length && <div className="empty-thread"><MessageSquareText/><b>Todavía no hay actualizaciones</b><span>La primera entrada iniciará el historial de esta obra.</span></div>}
      </div>
    </section>

    <div className="work-detail-grid">
      <WorkSection icon={<ClipboardCheck/>} title="Checklist">
        {canEdit && <form className="inline-form" onSubmit={addChecklist}><input name="title" required maxLength={240} placeholder="Nueva tarea"/><button disabled={checklistBusy === "new"} aria-label="Agregar tarea"><Plus/></button></form>}
        <div className="detail-list checklist-list">{work.checklist?.map(item => <div key={item._id} className={item.done ? "check-item-row done" : "check-item-row"}>
          <button className="check-toggle" disabled={!canEdit || checklistBusy === item._id} onClick={() => toggleChecklist(item)} aria-label={`${item.done ? "Marcar pendiente" : "Marcar completa"}: ${item.title}`}><i>{item.done && <Check/>}</i><span><b>{item.title}</b><small>Creada {dateTime(item.createdAt || fallbackCreatedAt)} · Último cambio {dateTime(item.updatedAt || item.completedAt || fallbackUpdatedAt)}</small></span></button>
          {canEdit && <button className="check-delete" disabled={checklistBusy === item._id} onClick={() => removeChecklist(item)} aria-label={`Eliminar ${item.title}`}><Trash2/></button>}
        </div>)}</div>
      </WorkSection>
      <WorkSection icon={<Timer/>} title="Avances">
        {canEdit && <form className="mini-form" onSubmit={advance}><input name="date" type="date" required/><input name="percentage" type="number" min="0" max="100" required placeholder="% total"/><input name="note" required placeholder="Detalle del avance"/><button className="primary-btn">Registrar</button></form>}
        <div className="detail-list">{work.advances?.slice().reverse().map((item, index) => <div className="detail-row" key={index}><b>{item.percentage}%</b><span>{item.note}</span><small>{date(item.date)}</small></div>)}</div>
      </WorkSection>
      <WorkSection icon={<FileCheck2/>} title="Certificados">
        {canEdit && <form className="mini-form" onSubmit={certificate}><input name="number" required placeholder="Número"/><input name="period" required placeholder="Período"/><input name="percentage" type="number" min="0" max="100" required placeholder="%"/><input name="amount" type="number" min="0" step=".01" required placeholder="Importe $"/><input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png"/><button className="primary-btn">Aprobar</button></form>}
        <div className="detail-list">{work.certificates?.slice().reverse().map((item, index) => <div className="detail-row" key={index}><b>#{item.number}</b><span>{item.period} · {item.percentage}%</span><strong>{money(item.amountCents)}</strong><small>{item.invoiced ? "Facturado" : "Pendiente de facturar"}</small></div>)}</div>
      </WorkSection>
      <WorkSection icon={<Users/>} title="Personal y jornales">
        {canEdit && <form className="mini-form" onSubmit={labor}><input name="person" required placeholder="Persona"/><input name="date" type="date" required/><input name="hours" type="number" min="0" step=".5" required placeholder="Horas"/><input name="cost" type="number" min="0" step=".01" required placeholder="Costo $"/><button className="primary-btn">Agregar</button></form>}
        <div className="detail-list">{work.labor?.slice().reverse().map((item, index) => <div className="detail-row" key={index}><b>{item.person}</b><span>{item.hours} h · {date(item.date)}</span><strong>{money(item.costCents)}</strong></div>)}</div>
      </WorkSection>
    </div>
  </>;
}

function WorkSection({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) { return <section className="panel work-detail-section"><div className="panel-head"><div className="section-title">{icon}<h2>{title}</h2></div></div>{children}</section>; }
function rGuard(value: unknown): value is Work { return typeof value === "object" && value !== null && "_id" in value; }
function initials(name: string) { return name.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase(); }
