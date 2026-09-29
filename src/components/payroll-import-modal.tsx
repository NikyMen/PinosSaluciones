"use client";

import { useEffect, useState } from "react";
import { FileSpreadsheet, TriangleAlert, X } from "lucide-react";
import { SearchSelect, type Option } from "@/components/fields";
import { date, money } from "@/lib/format";

type Preview = {
  sheet: string; rows: number; skipped: Array<{ line: number; reason: string }>; from: string; to: string; totalCents: number; alreadyLoaded: number;
  people: { total: number; matched: number; toCreate: string[] };
  rates: Array<{ name: string; rateCents: number; currentCents: number | null }>;
  sites: Array<{ site: string; rows: number; totalCents: number; workId: string; workLabel: string }>;
  works: Option[];
};
type Summary = { entries: number; skipped: number; workersCreated: number; fileNumbersSet: number; worksCreated: number; ratesUpdated: number; totalCents: number; conflicts: string[] };

const NEW = "new";

/**
 * Importar la planilla de la quincena: se sube el Excel, se ve qué va a pasar
 * (personas, tarifas, lo que ya estaba cargado) y se une cada obra de la
 * planilla con una del sistema, o se crea. Recién ahí se guarda.
 */
export function PayrollImportModal({ onClose, onDone }: { onClose: () => void; onDone: (summary: Summary, from: string, to: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sites, setSites] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function send(mode: "preview" | "confirm", chosen = file) {
    if (!chosen) return;
    const form = new FormData();
    form.set("file", chosen); form.set("mode", mode);
    if (mode === "confirm") form.set("sites", JSON.stringify(sites));
    setBusy(true); setError("");
    const response = await fetch("/api/payroll/import", { method: "POST", body: form });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setError(result.error || "No se pudo leer la planilla");
    if (mode === "preview") {
      setPreview(result);
      // Lo que tiene una obra clara queda unido; el resto, por defecto, se crea.
      setSites(Object.fromEntries((result as Preview).sites.map(site => [site.site, site.workId || NEW])));
    } else onDone(result as Summary, preview!.from, preview!.to);
  }

  const options: Option[] = [{ value: NEW, label: "Crear obra nueva" }, ...(preview?.works || [])];
  const changedRates = preview?.rates.filter(rate => rate.currentCents !== rate.rateCents) || [];

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={() => !busy && onClose()} aria-label="Cerrar" />
    <section className="modal entity-modal payroll-import-modal" role="dialog" aria-modal="true" aria-labelledby="payroll-import-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><FileSpreadsheet /></span><div>
        <p className="eyebrow">LIQUIDACIÓN</p>
        <h2 id="payroll-import-title">Importar la planilla de la quincena</h2>
        <small>El Excel con Nº Legajo, Apellido y Nombre, Categoría, Día, T. Trabajo, Horas, Obra y Total, y al costado la tabla de tarifas.</small>
      </div></div><button className="icon-btn" onClick={() => !busy && onClose()} aria-label="Cerrar"><X /></button></header>
      <div className="modal-form-body">
        <label className="payroll-file"><span>Planilla (.xlsx)</span>
          <input type="file" accept=".xlsx" disabled={busy} onChange={event => { const next = event.target.files?.[0] || null; setFile(next); setPreview(null); if (next) void send("preview", next); }} />
        </label>
        {busy && !preview && <div className="loading-state">Leyendo la planilla…</div>}

        {preview && <>
          <div className="price-kpis">
            <div className="stock-kpi"><span>Período</span><strong>{date(preview.from)} al {date(preview.to)}</strong><small>Hoja “{preview.sheet}”</small></div>
            <div className="stock-kpi"><span>Filas</span><strong>{preview.rows}</strong><small>{preview.alreadyLoaded ? `${preview.alreadyLoaded} ya estaban cargadas: no se repiten` : "Todas nuevas"}</small></div>
            <div className="stock-kpi"><span>Total de la planilla</span><strong>{money(preview.totalCents)}</strong><small>{preview.people.total} personas</small></div>
          </div>
          {preview.skipped.length > 0 && <p className="convert-warning"><TriangleAlert size={17} /><span>{preview.skipped.length} filas no se pueden leer y quedan afuera: {preview.skipped.slice(0, 5).map(row => `fila ${row.line} (${row.reason})`).join(", ")}.</span></p>}
          {preview.people.toCreate.length > 0 && <p className="convert-warning"><TriangleAlert size={17} /><span>{preview.people.toCreate.length} personas no están en el legajo y se dan de alta con su número: {preview.people.toCreate.slice(0, 8).join(", ")}{preview.people.toCreate.length > 8 ? "…" : ""}</span></p>}
          {changedRates.length > 0 && <p className="payroll-note">Tarifas: {changedRates.length} {changedRates.length === 1 ? "tipo de trabajo se carga o cambia" : "tipos de trabajo se cargan o cambian"} ({changedRates.slice(0, 4).map(rate => `${rate.name} ${money(rate.rateCents)}`).join(", ")}{changedRates.length > 4 ? "…" : ""}).</p>}

          <div className="receipt-table-head"><b>¿A qué obra va cada una?</b><span>Las que no tienen una obra clara se crean nuevas (después les ponés el cliente).</span></div>
          <div className="table-scroll"><table className="payroll-sites"><thead><tr><th>Obra en la planilla</th><th>Filas</th><th>Importe</th><th>Obra del sistema</th></tr></thead><tbody>
            {preview.sites.map(site => <tr key={site.site}>
              <td data-label="Obra en la planilla"><b>{site.site}</b></td>
              <td data-label="Filas">{site.rows}</td>
              <td data-label="Importe">{money(site.totalCents)}</td>
              <td data-label="Obra del sistema"><SearchSelect name={`site-${site.site}`} options={options} value={sites[site.site] || NEW} onChange={value => setSites(current => ({ ...current, [site.site]: value || NEW }))} /></td>
            </tr>)}
          </tbody></table></div>
        </>}
      </div>
      {error && <p className="form-error modal-error">{error}</p>}
      <footer><span>{preview ? `Se cargan ${preview.rows - preview.alreadyLoaded} partes por ${money(preview.totalCents)}.` : "Primero se muestra qué va a pasar; nada se guarda hasta confirmar."}</span>
        <button type="button" className="secondary-btn" disabled={busy} onClick={onClose}>Cancelar</button>
        <button type="button" className="primary-btn" disabled={busy || !preview} onClick={() => { void send("confirm"); }}>{busy && preview ? "Cargando…" : "Importar la quincena"}</button></footer>
    </section>
  </div>;
}
