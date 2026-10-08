"use client";

import { useEffect, useState } from "react";
import { ArrowRightLeft, X } from "lucide-react";
import { DateInput, MoneyInput } from "@/components/fields";
import { money, todayIso } from "@/lib/format";
import { CashAccountSelect } from "@/components/cash-account-select";
import { TRANSFER_IN_ACCOUNT, TRANSFER_OUT_ACCOUNT } from "@/lib/account-catalog";

/**
 * Pase entre cuentas propias: de la caja al banco, de un banco a otro. Deja dos
 * movimientos atados (el egreso en el origen y el ingreso en el destino) con
 * las cuentas del plan que corresponden, sin que nadie las tenga que elegir.
 */
export function CashTransferModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [amount, setAmount] = useState(0);
  const [day, setDay] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // El servidor avisó que parece repetido: el próximo envío lo confirma.
  const [duplicate, setDuplicate] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    const response = await fetch("/api/cash/transfer", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date: day, from: form.get("from"), to: form.get("to"), amountCents: Math.round(amount * 100),
        description: form.get("description"), reference: form.get("reference"), confirmDuplicate: duplicate,
      }),
    });
    const result = await response.json();
    setBusy(false);
    if (response.status === 409) { setDuplicate(true); return setError(result.error); }
    if (!response.ok) return setError(result.error || "No se pudo registrar el pase");
    onDone(`Pase ${result.transferId} registrado: ${money(Math.round(amount * 100))} de ${String(result.out?.account || "")} a ${String(result.into?.account || "")}.`);
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><ArrowRightLeft /></span><div>
        <p className="eyebrow">CAJA Y BANCOS</p>
        <h2 id="transfer-modal-title">Movimiento entre cuentas</h2>
        <small>Sale de una cuenta propia y entra en otra: queda un egreso y un ingreso atados.</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={event => { void submit(event); }}>
        <div className="modal-form-body">
          <div className="form-grid">
            <label><span>Fecha *</span><DateInput name="date" defaultValue={day} required recent onValueChange={setDay} /></label>
            <label><span>Importe *</span><MoneyInput name="amount" defaultValue={0} required onValueChange={value => { setAmount(value); setDuplicate(false); }} /></label>
            <label><span>Sale de *</span><CashAccountSelect name="from" required onChange={() => setDuplicate(false)} placeholder="La caja o cuenta de origen…" /></label>
            <label><span>Entra en *</span><CashAccountSelect name="to" required onChange={() => setDuplicate(false)} placeholder="La caja o cuenta de destino…" /></label>
            <label><span>Referencia</span><input name="reference" placeholder="N° de transferencia…" /></label>
            <label className="wide"><span>Detalle</span><input name="description" placeholder="Opcional" /></label>
          </div>
          <p className="invoice-note">Se imputa solo: egreso a <b>{TRANSFER_OUT_ACCOUNT}</b> en la cuenta de origen e ingreso a <b>{TRANSFER_IN_ACCOUNT}</b> en la de destino. Mueve la plata de lugar: no suma ni a ingresos ni a egresos. Las cuentas se dan de alta en Tesorería › Cajas y cuentas bancarias.</p>
        </div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer><span>Queda auditado.</span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={busy}>{busy ? "Guardando…" : duplicate ? "Es otro: registrarlo igual" : "Registrar el pase"}</button></footer>
      </form>
    </section>
  </div>;
}
