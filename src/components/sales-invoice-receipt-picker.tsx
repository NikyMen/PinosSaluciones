"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { companyOf } from "@/lib/companies";
import { date } from "@/lib/format";

type Receipt = { _id: string; number: string; date: string; company: string; clientId: string; client?: { name: string } };

export function SalesInvoiceReceiptPicker({ onClose, onPicked }: {
  onClose: () => void; onPicked: (draft: Record<string, unknown>) => void;
}) {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/remitos?status=por_facturar", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      setReceipts((await response.json()).items);
    }).catch(() => { if (!controller.signal.aborted) setError("No se pudieron leer los remitos pendientes"); });
    return () => controller.abort();
  }, []);

  const first = receipts?.find(receipt => receipt._id === ids[0]);
  async function next() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/invoices/draft?${new URLSearchParams({ remitos: ids.join(",") })}`);
      const result = await response.json();
      if (!response.ok || result.remitoIds?.length !== ids.length) { setError(result.error || "Algún remito dejó de estar disponible"); return; }
      onPicked(result);
    } catch { setError("No se pudo abrir la factura"); }
    finally { setBusy(false); }
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="sales-receipt-title">
      <header><h2 id="sales-receipt-title">Factura con remito</h2><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <div className="modal-form-body">
        <fieldset className="receipt-picker">
          <legend>Elegí remitos del mismo cliente y empresa</legend>
          {receipts?.map(receipt => <label key={receipt._id}>
            <input type="checkbox" checked={ids.includes(receipt._id)}
              disabled={busy || Boolean(first && (first.clientId !== receipt.clientId || first.company !== receipt.company))}
              onChange={event => setIds(current => event.target.checked ? [...current, receipt._id] : current.filter(id => id !== receipt._id))} />
            <b>{receipt.number}</b><small>{receipt.client?.name} · {companyOf(receipt.company).short} · {date(receipt.date)}</small>
          </label>)}
          {!error && (!receipts ? <p>Cargando…</p> : !receipts.length && <p>No hay remitos pendientes.</p>)}
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <footer><button className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={!ids.length || busy} onClick={() => void next()}>Continuar</button></footer>
    </section>
  </div>;
}
