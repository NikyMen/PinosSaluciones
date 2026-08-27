"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, FileUp, Paperclip, Phone, Plus, Search, Trash2, X } from "lucide-react";
import { amountToInput, displayDateToIso, isoPlusDays, isoToDisplayDate, maskAmount, maskDate, parseAmount, todayIso } from "@/lib/format";

/* ─────────────────────────────────────────────────────────────────────────────
   Campos de formulario compartidos.

   Todos publican su valor real en un <input type="hidden" name={name}>, así el
   `new FormData(form)` de quien los usa los lee igual que a un input común.
   ───────────────────────────────────────────────────────────────────────────── */

/** Importe con separador de miles en vivo: al tipear 1234567 se ve 1.234.567. */
export function MoneyInput({ name, defaultValue = 0, required, autoFocus, placeholder = "0,00", onValueChange }: {
  name: string; defaultValue?: number; required?: boolean; autoFocus?: boolean; placeholder?: string; onValueChange?: (value: number) => void;
}) {
  const [text, setText] = useState(() => amountToInput(defaultValue));
  const amount = parseAmount(text);

  return <div className="money-input">
    <span className="money-prefix">$</span>
    <input
      inputMode="decimal" autoComplete="off" autoFocus={autoFocus} placeholder={placeholder}
      value={text}
      onChange={event => { const next = maskAmount(event.target.value); setText(next); onValueChange?.(parseAmount(next)); }}
      onBlur={() => setText(current => (current ? amountToInput(parseAmount(current)) : ""))}
      aria-label="Importe en pesos"
    />
    <input type="hidden" name={name} value={amount || ""} />
    {required && !amount && <input type="text" className="validation-proxy" required tabIndex={-1} aria-hidden value="" onChange={() => {}} />}
  </div>;
}

/** Fecha siempre en dd/mm/aaaa, con calendario nativo al costado. */
export function DateInput({ name, defaultValue = "", required, autoFocus, quickRanges, hideToday, onValueChange }: {
  name: string; defaultValue?: string; required?: boolean; autoFocus?: boolean; quickRanges?: number[];
  /** En un vencimiento el atajo "Hoy" no tiene sentido: se puede sacar. */ hideToday?: boolean;
  onValueChange?: (iso: string) => void;
}) {
  const initialIso = defaultValue ? String(defaultValue).slice(0, 10) : "";
  const [text, setText] = useState(() => isoToDisplayDate(initialIso));
  const pickerRef = useRef<HTMLInputElement>(null);
  const iso = displayDateToIso(text);
  const invalid = text.length === 10 && !iso;

  function apply(nextIso: string) {
    setText(isoToDisplayDate(nextIso));
    onValueChange?.(nextIso);
  }

  return <div className="date-field">
    <div className={invalid ? "date-input invalid" : "date-input"}>
      <CalendarDays size={16} />
      <input
        inputMode="numeric" autoComplete="off" autoFocus={autoFocus} placeholder="dd/mm/aaaa" maxLength={10}
        value={text}
        onChange={event => { const next = maskDate(event.target.value); setText(next); onValueChange?.(displayDateToIso(next)); }}
        aria-label="Fecha en formato día, mes y año"
      />
      <button type="button" className="date-picker-btn" aria-label="Abrir calendario" onClick={() => { const picker = pickerRef.current; if (!picker) return; if (picker.showPicker) picker.showPicker(); else picker.click(); }}>
        <ChevronDown size={15} />
      </button>
      <input ref={pickerRef} type="date" className="native-picker" tabIndex={-1} aria-hidden value={iso} onChange={event => apply(event.target.value)} />
    </div>
    {quickRanges?.length ? <div className="date-quick">
      {quickRanges.map(days => <button type="button" key={days} className={iso === isoPlusDays(days) ? "active" : ""} onClick={() => apply(isoPlusDays(days))}>{days} días</button>)}
      {!hideToday && <button type="button" className={iso === todayIso() ? "active" : ""} onClick={() => apply(todayIso())}>Hoy</button>}
    </div> : null}
    <input type="hidden" name={name} value={iso} />
    {required && !iso && <input type="text" className="validation-proxy" required tabIndex={-1} aria-hidden value="" onChange={() => {}} />}
  </div>;
}

export type Option = { value: string; label: string; hint?: string };

/** Select buscable y redondeado. `onCreate` agrega el atajo "Crear nuevo…" al final. */
export function SearchSelect({ name, options, defaultValue = "", placeholder = "Seleccionar…", required, autoFocus, createLabel, onCreate, value: controlled, onChange }: {
  name: string; options: Option[]; defaultValue?: string; placeholder?: string; required?: boolean; autoFocus?: boolean;
  createLabel?: string; onCreate?: () => void; value?: string; onChange?: (value: string) => void;
}) {
  const [internal, setInternal] = useState(defaultValue);
  const selected = controlled ?? internal;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter(option => option.label.toLowerCase().includes(needle) || option.hint?.toLowerCase().includes(needle)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => { if (!wrapRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function toggle() {
    setQuery("");
    setHighlight(0);
    setOpen(value => !value);
  }

  function pick(value: string) {
    if (controlled === undefined) setInternal(value);
    onChange?.(value);
    setQuery("");
    setOpen(false);
  }

  const current = options.find(option => option.value === selected);

  return <div className="select-field" ref={wrapRef}>
    <button type="button" className={open ? "select-trigger open" : "select-trigger"} autoFocus={autoFocus} onClick={toggle} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}>
      <span className={current ? "select-value" : "select-value placeholder"}>{current?.label || placeholder}</span>
      <ChevronDown size={16} className={open ? "chevron open" : "chevron"} />
    </button>
    {open && <div className="select-popover" id={listId} role="listbox">
      {options.length > 6 && <div className="select-search"><Search size={15} /><input autoFocus value={query} placeholder="Buscar…" onChange={event => { setQuery(event.target.value); setHighlight(0); }} onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setHighlight(index => Math.min(index + 1, filtered.length - 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setHighlight(index => Math.max(index - 1, 0)); }
        if (event.key === "Enter") { event.preventDefault(); const option = filtered[highlight]; if (option) pick(option.value); }
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      }} /></div>}
      <div className="select-options">
        {filtered.map((option, index) => <button type="button" key={option.value} role="option" aria-selected={option.value === selected}
          className={`select-option${option.value === selected ? " selected" : ""}${index === highlight ? " highlight" : ""}`}
          onMouseEnter={() => setHighlight(index)} onClick={() => pick(option.value)}>
          <span><b>{option.label}</b>{option.hint && <small>{option.hint}</small>}</span>
          {option.value === selected && <Check size={15} />}
        </button>)}
        {!filtered.length && <p className="select-empty">Sin resultados para “{query}”.</p>}
      </div>
      {onCreate && <button type="button" className="select-create" onClick={() => { setOpen(false); onCreate(); }}><Plus size={15} /> {createLabel || "Crear nuevo"}</button>}
    </div>}
    <input type="hidden" name={name} value={selected} />
    {required && !selected && <input type="text" className="validation-proxy" required tabIndex={-1} aria-hidden value="" onChange={() => {}} />}
  </div>;
}

/** Lista de teléfonos con botón para sumar otro. Publica un JSON en el hidden. */
export function PhoneList({ name, defaultValue = [] }: { name: string; defaultValue?: string[] }) {
  const [phones, setPhones] = useState<string[]>(() => (defaultValue.length ? defaultValue : [""]));
  const filled = phones.map(phone => phone.trim()).filter(Boolean);

  return <div className="phone-list">
    {phones.map((phone, index) => <div className="phone-row" key={index}>
      <span className="phone-icon"><Phone size={15} /></span>
      <input type="tel" value={phone} placeholder={index === 0 ? "Teléfono principal" : `Teléfono ${index + 1}`} aria-label={index === 0 ? "Teléfono principal" : `Teléfono ${index + 1}`}
        onChange={event => setPhones(current => current.map((value, position) => position === index ? event.target.value : value))} />
      {phones.length > 1 && <button type="button" className="phone-remove" aria-label={`Quitar teléfono ${index + 1}`} onClick={() => setPhones(current => current.filter((_, position) => position !== index))}><Trash2 size={15} /></button>}
    </div>)}
    <button type="button" className="phone-add" onClick={() => setPhones(current => [...current, ""])}><Plus size={15} /> Agregar otro teléfono</button>
    <input type="hidden" name={name} value={JSON.stringify(filled)} />
  </div>;
}

/** Zona para soltar o elegir un archivo, en vez del "Choose file…" del navegador. */
export function FileDrop({ name, currentPath, accept = ".pdf,.jpg,.jpeg,.png,.webp,.xlsx" }: { name: string; currentPath?: string; accept?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);

  function assign(files: FileList | null) {
    if (!files?.length || !inputRef.current) return;
    const transfer = new DataTransfer();
    transfer.items.add(files[0]);
    inputRef.current.files = transfer.files;
    setFileName(files[0].name);
  }

  return <div className={dragging ? "file-drop dragging" : "file-drop"}
    onDragOver={event => { event.preventDefault(); setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={event => { event.preventDefault(); setDragging(false); assign(event.dataTransfer.files); }}
    onClick={() => inputRef.current?.click()}
    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inputRef.current?.click(); } }}
    role="button" tabIndex={0}
  >
    <input ref={inputRef} name={name} type="file" accept={accept} hidden onChange={event => setFileName(event.target.files?.[0]?.name || "")} />
    <span className="file-drop-icon"><FileUp size={20} /></span>
    {fileName ? <div className="file-drop-copy"><b>{fileName}</b><small>Listo para subir · hacé clic para cambiarlo</small></div>
      : <div className="file-drop-copy"><b>Arrastrá el archivo acá</b><small>o hacé clic para buscarlo · PDF, JPG, PNG o XLSX</small></div>}
    {fileName && <button type="button" className="file-drop-clear" aria-label="Quitar archivo" onClick={event => { event.stopPropagation(); if (inputRef.current) inputRef.current.value = ""; setFileName(""); }}><X size={15} /></button>}
    {currentPath && !fileName && <a className="file-drop-current" href={currentPath} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}><Paperclip size={13} /> Ver el archivo actual</a>}
  </div>;
}
