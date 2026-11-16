"use client";

import { useEffect, useState } from "react";
import { COMPANIES, COMPANY_KEYS, type CompanyKey } from "@/lib/companies";
import type { Signature } from "@/lib/document-signatures";

export function DocumentSignatureSettings() {
  const [items, setItems] = useState<Partial<Record<CompanyKey, Signature>> | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch("/api/document-signatures").then(async response => {
      if (!response.ok) throw new Error();
      const result = await response.json() as { items: Array<Signature & { company: CompanyKey }> };
      setItems(Object.fromEntries(result.items.map(item => [item.company, item])));
    }).catch(() => setError("No se pudo leer la firma de Tesorería"));
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>, company: CompanyKey) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(""); setError("");
    try {
      const response = await fetch("/api/document-signatures", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ company, name: form.get("name"), title: form.get("title") }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error || "No se pudo guardar la firma"); return; }
      setMessage(`Firma guardada para ${COMPANIES[company].short}.`);
    } catch { setError("No se pudo guardar la firma"); }
  }

  return <section className="table-panel">
    <h2>Firma de recibos y órdenes de pago</h2>
    {items && COMPANY_KEYS.map(company => <form className="toolbar" key={company} onSubmit={event => void save(event, company)}>
      <strong>{COMPANIES[company].short}</strong>
      <label>Nombre <input name="name" required maxLength={65} defaultValue={items[company]?.name} /></label>
      <label>Cargo <input name="title" required maxLength={65} defaultValue={items[company]?.title} /></label>
      <button className="secondary-btn">Guardar firma</button>
    </form>)}
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <p className="notice success" role="status">{message}</p>}
  </section>;
}
