"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { SearchSelect } from "@/components/fields";

type Row = { _id: string; number?: string; title?: string; code?: string; name?: string; description?: string; supplierRemito?: string };
type Links = { order: Row | null; work: Row | null; quote: Row | null; payments: Row[]; receipts: Row[]; options: { orders: Row[]; quotes: Row[] } };

export function ExpenseLinks({ id, canAssociate, onClose, onAssociated }: { id: string; canAssociate: boolean; onClose: () => void; onAssociated: () => void }) {
  const [data, setData] = useState<Links | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/expenses/${id}/links`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message || "No se pudieron leer los vínculos"); });
    return () => controller.abort();
  }, [id]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value || busy) return;
    setError("");
    setBusy(true);
    try {
      const [kind, target] = value.split(":");
      const response = await fetch(`/api/expenses/${id}/links`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, id: target }),
      });
      const body = await response.json();
      if (!response.ok) { setError(body.error || "No se pudo asociar"); return; }
      setData(body);
      setValue("");
      setSaved(true);
      onAssociated();
    } catch { setError("No se pudo verificar la asociación. Volvé a abrir la ficha para revisar."); }
    finally { setBusy(false); }
  }

  const options = data ? [
    ...data.options.orders.map(row => ({ value: `purchase:${row._id}`, label: [row.number, row.description].filter(Boolean).join(" · "), hint: "Orden de compra" })),
    ...data.options.quotes.map(row => ({ value: `quote:${row._id}`, label: [row.number, row.title].filter(Boolean).join(" · "), hint: "Cotización" })),
  ] : [];

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="expense-links-title">
      <header><h2 id="expense-links-title">Vinculado a la factura</h2><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <div className="modal-form-body">
        {data ? <dl className="form-grid">
          <div><dt>Orden de compra</dt><dd>{data.order ? <Link href={`/app/purchases?ver=${data.order._id}`}>{data.order.number}</Link> : "—"}</dd></div>
          <div><dt>Cotización</dt><dd>{data.quote ? <Link href={`/app/quotes/${data.quote._id}`}>{data.quote.number} · {data.quote.title}</Link> : "—"}</dd></div>
          <div><dt>Obra</dt><dd>{data.work ? <Link href={`/app/works/${data.work._id}`}>{data.work.code} · {data.work.name}</Link> : "—"}</dd></div>
          <div><dt>Órdenes de pago</dt><dd>{data.payments.length ? <ul>{data.payments.map(row => <li key={row._id}><Link href={`/app/payments?buscar=${encodeURIComponent(row.number || "")}`}>{row.number}</Link></li>)}</ul> : "—"}</dd></div>
          <div><dt>Remitos</dt><dd>{data.receipts.length ? <ul>{data.receipts.map(row => <li key={row._id}><Link href={`/app/remitos-compra?buscar=${encodeURIComponent(row.number || "")}`}>{row.supplierRemito || row.number}</Link></li>)}</ul> : "—"}</dd></div>
        </dl> : !error && <p>Cargando…</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {saved && <p className="notice success" role="status">Se guardó la asociación.</p>}
        {canAssociate && data && !data.order && <form className="toolbar" onSubmit={save}>
          <SearchSelect name="target" options={options} value={value} onChange={setValue} placeholder={options.length ? "Asociar a OC / cotización" : "No hay órdenes o cotizaciones relacionadas"} />
          <button className="primary-btn" disabled={!value || busy}>{busy ? "Guardando…" : "Asociar"}</button>
        </form>}
      </div>
      <footer><button className="secondary-btn" onClick={onClose}>Cerrar</button></footer>
    </section>
  </div>;
}
