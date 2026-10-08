"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Paperclip, PackagePlus, Search } from "lucide-react";
import { SearchSelect } from "@/components/fields";
import { PurchaseDetailModal } from "@/components/purchase-detail";
import { date, qty } from "@/lib/format";
import { companyOf } from "@/lib/companies";
import { warehouseLabel } from "@/lib/warehouses";
import { fetchAllRecords } from "@/lib/fetch-all-records";

type Receipt = {
  _id: string; number: string; supplierRemito?: string; date: string; warehouse?: string; status: string; final?: boolean; notes?: string; attachment?: string; userName?: string;
  company?: string; purchaseId: string; supplierName: string; lines: Array<{ name: string; quantity: number; unit?: string }>;
  order: { _id: string; number: string; status: string; receptionStatus?: string } | null;
};
type Order = { _id: string; number: string; stage: string; status: string; description?: string; amountCents?: number; receptionStatus?: string };

/**
 * Remitos de compra (requerimiento integral v4): lo que entregó cada proveedor,
 * contra su orden de compra. Lo cargan Compras o el Depósito; al cargarlo suma
 * al stock. El remito final cierra la orden.
 */
export function PurchaseReceiptsView({ canReceive }: { canReceive: boolean }) {
  const [rows, setRows] = useState<Receipt[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [orderFor, setOrderFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/purchase-receipts?search=${encodeURIComponent(search)}`);
    const body = await response.json();
    if (!response.ok) { setRows([]); return setError(body.error || "No se pudieron leer los remitos"); }
    setRows(body.items as Receipt[]);
  }, [search]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 250); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (!canReceive) return;
    void fetchAllRecords<Order>("purchases").then(items => setOrders(items.filter(item => item.stage !== "solicitud" && !["cerrada", "anulada", "cancelada"].includes(item.status))));
  }, [canReceive]);

  const options = useMemo(() => orders.map(order => ({ value: order._id, label: `${order.number} · ${order.description || ""}`, hint: order.receptionStatus === "parcial" ? "Recibida en parte" : "Sin recibir" })), [orders]);

  return <>
    <Link href="/app/purchases" className="back-link"><ArrowLeft /> Volver a solicitudes y órdenes</Link>
    <div className="page-heading"><div>
      <p className="eyebrow">COMPRAS</p>
      <h1>Remitos de compra</h1>
      <p>Lo que entregó cada proveedor, contra su orden de compra. Al cargarlo suma al stock; puede ser parcial y el remito final cierra la orden.</p>
    </div></div>
    <div className="toolbar">
      <div className="search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Remito, orden de compra…" aria-label="Buscar remitos" /></div>
      {canReceive && <div className="receipt-order-pick">
        <SearchSelect name="order" options={options} value="" onChange={value => value && setOrderFor(value)} placeholder={orders.length ? "Cargar remito de la orden…" : "No hay órdenes por recibir"} />
        <PackagePlus size={17} />
      </div>}
    </div>
    {error && <div className="notice error">{error}</div>}
    <section className="table-panel">
      {rows === null ? <div className="loading-state">Cargando…</div> : !rows.length ? <div className="empty-state"><p>Todavía no se cargaron remitos de compra.</p></div>
        : <div className="table-scroll"><table><thead><tr><th>Remito</th><th>Fecha</th><th>Orden</th><th>Proveedor</th><th>Llegó</th><th>Estado</th><th /></tr></thead><tbody>
          {rows.map(row => <tr key={row._id} className="clickable-row" onClick={() => row.order && setOrderFor(row.order._id)} title="Abrir la orden de compra">
            <td data-label="Remito"><b>{row.supplierRemito || row.number}</b><small className="tracking-sub">{row.number} · {row.userName || ""}</small></td>
            <td data-label="Fecha">{date(row.date)}</td>
            <td data-label="Orden">{row.order ? <><b>{row.order.number}</b> <span className={`company-badge ${companyOf(row.company).key}`}>{companyOf(row.company).short}</span></> : "—"}</td>
            <td data-label="Proveedor">{row.supplierName || "—"}</td>
            <td data-label="Llegó"><ul className="transfer-lines">{row.lines.map((line, index) => <li key={index}>{qty(line.quantity)} {line.unit || ""} · {line.name}</li>)}</ul><small className="tracking-sub">{warehouseLabel(row.warehouse || "central")}</small></td>
            <td data-label="Estado"><span className={`badge ${row.status === "observada" ? "remito-pendiente" : "remito-facturado"}`}>{row.status === "observada" ? "Observada" : "Conforme"}</span>{row.final && <small className="tracking-sub">Final</small>}{row.status === "observada" && row.notes && <small className="tracking-sub">{row.notes}</small>}</td>
            <td className="row-actions" onClick={event => event.stopPropagation()}>{row.attachment && <a className="row-action-wide" href={row.attachment} target="_blank" rel="noreferrer"><Paperclip size={14} /> Remito</a>}</td>
          </tr>)}
        </tbody></table></div>}
    </section>
    {orderFor && <PurchaseDetailModal purchaseId={orderFor} onClose={() => setOrderFor(null)} onChanged={() => { void load(); }} />}
  </>;
}
