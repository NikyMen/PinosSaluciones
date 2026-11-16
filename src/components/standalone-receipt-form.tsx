"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { SearchSelect } from "@/components/fields";
import { fetchAllRecords } from "@/lib/fetch-all-records";
import { todayIso } from "@/lib/format";

type Row = { _id: string; name?: string; number?: string; code?: string; title?: string };
type Line = { key: number; name: string; quantity: string; unit: string };
const line = (key: number): Line => ({ key, name: "", quantity: "", unit: "unidad" });

export function StandaloneReceiptForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [works, setWorks] = useState<Row[]>([]);
  const [quotes, setQuotes] = useState<Row[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [project, setProject] = useState("");
  const [lines, setLines] = useState([line(0)]);
  const [nextKey, setNextKey] = useState(1);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchAllRecords<Row>("suppliers").then(setSuppliers);
    void fetchAllRecords<Row>("works").then(setWorks);
    void fetchAllRecords<Row>("quotes").then(setQuotes);
  }, []);

  const projects = [
    ...works.map(row => ({ value: `workId:${row._id}`, label: [row.code, row.name].filter(Boolean).join(" · "), hint: "Obra" })),
    ...quotes.map(row => ({ value: `quoteId:${row._id}`, label: [row.number, row.title].filter(Boolean).join(" · "), hint: "Cotización" })),
  ];

  function update(key: number, changes: Partial<Line>) {
    setLines(rows => rows.map(row => row.key === key ? { ...row, ...changes } : row));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierId || !project || saving) return;
    const [field, id] = project.split(":");
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/purchase-receipts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          supplierId, [field]: id, supplierRemito: form.get("supplierRemito"), date: form.get("date"), notes: form.get("notes"),
          lines: lines.map(({ name, quantity, unit }) => ({ name, quantity: Number(quantity), unit })),
        }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error || "No se pudo cargar el remito"); return; }
      onSaved();
    } catch { setError("No se pudo verificar si se guardó el remito. Revisá el listado."); }
    finally { setSaving(false); }
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" type="button" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="standalone-receipt-title">
      <header><h2 id="standalone-receipt-title">Remito sin OC</h2><button className="icon-btn" type="button" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={submit}>
        <div className="modal-form-body form-grid">
          <label><span>Proveedor *</span><SearchSelect name="supplierId" value={supplierId} onChange={setSupplierId} options={suppliers.map(row => ({ value: row._id, label: row.name || "" }))} /></label>
          <label><span>Cotización / Obra *</span><SearchSelect name="project" value={project} onChange={setProject} options={projects} /></label>
          <label><span>Número de remito *</span><input required name="supplierRemito" maxLength={60} /></label>
          <label><span>Fecha *</span><input required name="date" type="date" defaultValue={todayIso()} /></label>
          <fieldset className="receipt-picker">
            <legend>Materiales recibidos</legend>
            {lines.map((row, index) => <div className="form-grid" key={row.key}>
              <label><span>Material *</span><input required value={row.name} maxLength={300} onChange={event => update(row.key, { name: event.target.value })} /></label>
              <label><span>Cantidad *</span><input type="number" min="0.001" step="0.001" required value={row.quantity} onChange={event => update(row.key, { quantity: event.target.value })} /></label>
              <label><span>Unidad *</span><input required value={row.unit} maxLength={30} onChange={event => update(row.key, { unit: event.target.value })} /></label>
              {lines.length > 1 && <button className="icon-btn" type="button" aria-label={`Quitar material ${index + 1}`} onClick={() => setLines(rows => rows.filter(item => item.key !== row.key))}><Trash2 size={16} /></button>}
            </div>)}
            <button className="secondary-btn" type="button" disabled={lines.length >= 200} onClick={() => { setLines(rows => [...rows, line(nextKey)]); setNextKey(nextKey + 1); }}><Plus size={16} /> Agregar material</button>
          </fieldset>
          <label><span>Notas</span><textarea name="notes" maxLength={1000} /></label>
        </div>
        {error && <p className="form-error modal-error" role="alert">{error}</p>}
        <footer><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={!supplierId || !project || saving}>{saving ? "Guardando…" : "Guardar remito"}</button></footer>
      </form>
    </section>
  </div>;
}
