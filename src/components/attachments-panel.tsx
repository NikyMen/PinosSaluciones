"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, History, Paperclip, RefreshCw, Upload, X } from "lucide-react";
import { dateTime } from "@/lib/format";

export type AttachmentEntity = "purchases" | "payments" | "expenses" | "cash" | "purchaseReceipts";
type FileRef = { _id?: string; path: string; name?: string; size?: number; label?: string; uploadedAt?: string; uploadedByName?: string; replacedAt?: string; replacedByName?: string; legacy?: boolean };

const downloadHref = (file: FileRef) => `${file.path}?download=${encodeURIComponent(file.name || "archivo")}`;

/**
 * Los adjuntos de un documento: se ven, se descargan y se reemplazan; no se
 * borran. Cada uno dice quién lo subió y cuándo; los reemplazados quedan en el
 * historial (requerimiento integral v4, punto 5).
 */
export function AttachmentsPanel({ entity, id, canEdit, title = "Adjuntos", label, onChanged }: { entity: AttachmentEntity; id: string; canEdit: boolean; title?: string; label?: string; onChanged?: () => void }) {
  const [files, setFiles] = useState<FileRef[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/files/${entity}/${id}`);
    const body = await response.json();
    if (!response.ok) { setFiles([]); return setError(body.error || "No se pudieron leer los adjuntos"); }
    setFiles(body.items as FileRef[]);
  }, [entity, id]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  async function upload(file: File | undefined, replaces?: string) {
    if (!file) return;
    setBusy(replaces || "new"); setError("");
    try {
      const form = new FormData(); form.set("file", file);
      const uploaded = await fetch("/api/uploads", { method: "POST", body: form });
      const result = await uploaded.json();
      if (!uploaded.ok) throw new Error(result.error || "No se pudo subir el archivo");
      const response = await fetch(`/api/files/${entity}/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: result.path, name: result.name, size: result.size, label, replaces }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo adjuntar");
      setFiles(body.items as FileRef[]);
      onChanged?.();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "No se pudo adjuntar"); }
    finally { setBusy(""); }
  }

  const active = (files || []).filter(file => !file.replacedAt);
  const replaced = (files || []).filter(file => file.replacedAt);
  return <div className="attachments-panel">
    <div className="attachments-head"><b><Paperclip size={14} /> {title}</b>
      {replaced.length > 0 && <button type="button" className="link-btn" onClick={() => setShowHistory(value => !value)}><History size={13} /> {showHistory ? "Ocultar" : `Ver ${replaced.length} reemplazado${replaced.length === 1 ? "" : "s"}`}</button>}
    </div>
    {files === null ? <small className="muted">Cargando…</small> : !active.length && <small className="muted">Sin archivos.</small>}
    <ul>{active.map(file => <li key={file._id || file.path}>
      <a href={file.path} target="_blank" rel="noreferrer">{file.name || "Archivo"}</a>{file.label && <em> · {file.label}</em>}
      <small>{file.uploadedByName ? `${file.uploadedByName} · ` : ""}{file.uploadedAt ? dateTime(file.uploadedAt) : ""}</small>
      <a className="icon-link" href={downloadHref(file)} title="Descargar" aria-label={`Descargar ${file.name || "el archivo"}`}><Download size={14} /></a>
      {canEdit && <label className="icon-link" title="Reemplazar: el anterior queda en el historial">{busy === (file._id || "legacy") ? "…" : <RefreshCw size={14} />}
        <input type="file" hidden onChange={event => { void upload(event.target.files?.[0], file.legacy ? "legacy" : file._id); event.target.value = ""; }} /></label>}
    </li>)}</ul>
    {showHistory && <ul className="attachments-history">{replaced.map(file => <li key={file._id || file.path}>
      <a href={file.path} target="_blank" rel="noreferrer">{file.name || "Archivo"}</a>
      <small>Subido {file.uploadedAt ? dateTime(file.uploadedAt) : ""}{file.uploadedByName ? ` por ${file.uploadedByName}` : ""} · reemplazado {file.replacedAt ? dateTime(file.replacedAt) : ""}{file.replacedByName ? ` por ${file.replacedByName}` : ""}</small>
    </li>)}</ul>}
    {canEdit && <label className="secondary-btn attachments-add">{busy === "new" ? "Subiendo…" : <><Upload size={14} /> Agregar archivo</>}
      <input type="file" hidden onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></label>}
    {error && <p className="form-error">{error}</p>}
  </div>;
}

/** Los adjuntos de un registro de la lista, en una ventana. */
export function AttachmentsModal({ entity, id, label, canEdit, onClose }: { entity: AttachmentEntity; id: string; label: string; canEdit: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="attachments-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Paperclip /></span><div>
        <p className="eyebrow">ADJUNTOS</p><h2 id="attachments-title">{label}</h2><small>Se ven, se descargan y se reemplazan; el reemplazado queda en el historial.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <div className="modal-form-body"><AttachmentsPanel entity={entity} id={id} canEdit={canEdit} title="Archivos" /></div>
    </section>
  </div>;
}
