"use client";

import { useState } from "react";
import { Landmark, X } from "lucide-react";
import { DateInput } from "@/components/fields";
import { CashAccountSelect, forgetCashAccounts } from "@/components/cash-account-select";
import { date, money, todayIso } from "@/lib/format";

type CheckRow = Record<string, unknown> & { _id: string };

/**
 * Cierra el circuito de un cheque (anexo de Tesorería v5.1): el propio, cuando
 * el banco lo debita ("Transferencia de cheque diferido al banco"); el de
 * terceros, cuando se deposita. Los dos son un pase entre cuentas.
 */
export function CheckActionModal({ check, action, onClose, onSaved }: { check: CheckRow; action: "debit" | "deposit"; onClose: () => void; onSaved: () => void }) {
  const [day, setDay] = useState(todayIso());
  const [bankAccountId, setBankAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const debit = action === "debit";
  const kind = check.format === "echeq" ? "e-Cheq" : "cheque";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!day) return setError("Poné la fecha");
    if (!debit && !bankAccountId) return setError("Elegí el banco donde se deposita");
    setBusy(true); setError("");
    const response = await fetch(`/api/checks/${check._id}/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: day, ...(debit ? {} : { bankAccountId }) }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setBusy(false); return setError(body.error || "No se pudo registrar"); }
    forgetCashAccounts();
    onSaved();
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal entity-modal" role="dialog" aria-modal="true" aria-labelledby="check-action-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><Landmark /></span><div>
        <p className="eyebrow">{kind.toUpperCase()} N° {String(check.number || "")}</p>
        <h2 id="check-action-title">{debit ? "Registrar el débito del banco" : "Depositar el cheque"}</h2>
        <small>{money(Number(check.amountCents || 0))} · {String(check.bank || "")} · cobro {date(String(check.dueDate))}</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={event => { void save(event); }}>
        <div className="modal-form-body"><div className="form-grid">
          <label><span>{debit ? "Fecha en que lo debitó el banco *" : "Fecha del depósito *"}</span><DateInput name="date" defaultValue={day} required onValueChange={setDay} /></label>
          {!debit && <label><span>Banco *</span><CashAccountSelect name="bankAccountId" value={bankAccountId} onChange={setBankAccountId} types={["cuenta_corriente", "caja_ahorro", "billetera"]} required /></label>}
        </div>
        <p className="muted-line">{debit
          ? "Queda el pase del banco a la cuenta de cheques diferidos: recién ahí baja el saldo del banco."
          : "Queda el pase de Valores al Cobro al banco elegido."}</p></div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={busy}>{busy ? "Guardando…" : debit ? "Registrar el débito" : "Depositar"}</button></footer>
      </form>
    </section>
  </div>;
}
