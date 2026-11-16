"use client";

import { useEffect, useState } from "react";

type Category = { _id: string; name: string; allowed: boolean };

function useCategories() {
  const [items, setItems] = useState<Category[]>([]);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    void fetch("/api/work-categories").then(async response => {
      if (!response.ok) throw new Error();
      setItems((await response.json()).items);
    }).catch(() => setLoadError("No se pudieron leer los rubros"));
  }, []);
  return { items, setItems, loadError };
}

export function ProjectCategoryField({ value, required, readOnly }: { value: unknown; required?: boolean; readOnly?: boolean }) {
  const { items, loadError } = useCategories();
  const id = String(value || "");
  return <label><span>Rubro de obra {required && "*"}</span>
    {readOnly ? <output>{items.find(item => item._id === id)?.name || "—"}</output>
      : <select name="workCategoryId" required={required} defaultValue={id} key={items.length}>
        <option value="">Elegí un rubro…</option>
        {items.filter(item => item.allowed || item._id === id).map(item => <option key={item._id} value={item._id}>{item.name}</option>)}
      </select>}
    {loadError && <small className="form-error">{loadError}</small>}
  </label>;
}

export function WorkCategorySettings() {
  const { items, setItems, loadError } = useCategories();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setError("");
    setSaved("");
    try {
      const response = await fetch("/api/work-categories", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, name: values.get("name"), allowed: values.has("allowed") }),
      });
      const item = await response.json();
      if (!response.ok) { setError(item.error || "No se pudo guardar el rubro"); return; }
      setItems(current => id ? current.map(row => row._id === id ? item : row) : [...current, item]);
      setSaved(item.name);
      if (!id) form.reset();
    } catch { setError("No se pudo guardar el rubro"); }
  }

  return <section className="table-panel" aria-labelledby="work-categories-heading">
    <h2 id="work-categories-heading">Rubros de obra</h2>
    {items.map(item => <form className="toolbar" key={item._id} onSubmit={event => void submit(event, item._id)}>
      <label><span>Rubro</span> <input name="name" defaultValue={item.name} required maxLength={100} /></label>
      <label><input name="allowed" type="checkbox" defaultChecked={item.allowed} /> Activo</label>
      <button className="secondary-btn">Guardar</button>
    </form>)}
    <form className="toolbar" onSubmit={event => void submit(event)}>
      <label><span>Nuevo rubro</span> <input name="name" required maxLength={100} /></label>
      <input type="hidden" name="allowed" value="on" />
      <button className="secondary-btn">Agregar</button>
    </form>
    {(error || loadError) && <p className="notice error" role="alert">{error || loadError}</p>}
    {saved && <p className="notice success" role="status">Se guardó {saved}.</p>}
  </section>;
}
