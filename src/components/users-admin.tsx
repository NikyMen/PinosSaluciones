"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, Pencil, Plus, ShieldCheck, UserRoundCheck, X } from "lucide-react";
import { entities, entityLabels, ROLES, roleLabels, viewSections, viewSectionLabels, type Entity, type Role, type ViewSection } from "@/lib/constants";
import { defaultPermissionsForRole, type UserPermissions } from "@/lib/permissions";

type User = { _id: string; name: string; email: string; role: Role; active: boolean; permissions: UserPermissions };
type UserPayload = { name: string; email: string; role: Role; active: boolean; permissions: UserPermissions; password?: string };

const editDependencies: Partial<Record<Entity, ViewSection[]>> = {
  quotes: ["clients"], works: ["clients", "quotes"], purchases: ["suppliers", "works"], expenses: ["suppliers", "works"],
  invoices: ["clients", "works"], collections: ["clients", "invoices"], payments: ["suppliers", "expenses"], checks: ["clients", "suppliers"],
};

export function UsersAdmin() {
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<User | "new" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/users");
    const result = await response.json();
    if (response.ok) setUsers(result.items || []);
    else setError(result.error || "No se pudo cargar el equipo");
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previous; };
  }, [selected]);

  async function save(payload: UserPayload) {
    setError("");
    const isNew = selected === "new";
    const response = await fetch(isNew ? "/api/users" : `/api/users/${(selected as User)._id}`, {
      method: isNew ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) { setError(result.error || "No se pudo guardar el usuario"); return false; }
    setSelected(null);
    await load();
    return true;
  }

  async function toggle(user: User) {
    setError("");
    const response = await fetch(`/api/users/${user._id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !user.active }),
    });
    if (!response.ok) setError((await response.json()).error);
    else load();
  }

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">CONFIGURACIÓN</p><h1>Usuarios y permisos</h1><p>Definí exactamente qué secciones puede ver y editar cada integrante.</p></div>
      <button className="primary-btn" onClick={() => { setError(""); setSelected("new"); }}><Plus size={18}/> Nuevo usuario</button>
    </div>
    {error && !selected && <div className="notice error">{error}</div>}
    <section className="panel users-panel">
      <div className="panel-head"><div><h2>Equipo</h2><p>{users.filter(user => user.active).length} cuentas activas · {users.length} totales</p></div><ShieldCheck/></div>
      <div className="user-list">
        {users.map(user => <div key={user._id}>
          <span className="avatar">{initials(user.name)}</span>
          <div><b>{user.name}</b><small>{user.email} · {roleLabels[user.role]}</small><span className="user-access-summary">{user.permissions.view.length} secciones · {user.permissions.edit.length} editables</span></div>
          <button className="user-edit-btn" onClick={() => { setError(""); setSelected(user); }}><Pencil size={15}/> Editar acceso</button>
          <button className={user.active ? "toggle active" : "toggle"} onClick={() => toggle(user)}><i/>{user.active ? "Activo" : "Inactivo"}</button>
        </div>)}
      </div>
    </section>
    {selected && <UserModal key={selected === "new" ? "new" : selected._id} user={selected === "new" ? null : selected} error={error} onClose={() => setSelected(null)} onSave={save}/>}
  </>;
}

function UserModal({ user, error, onClose, onSave }: { user: User | null; error: string; onClose: () => void; onSave: (payload: UserPayload) => Promise<boolean> }) {
  const [role, setRole] = useState<Role>(user?.role ?? "arquitecto");
  const [permissions, setPermissions] = useState<UserPermissions>(user?.permissions ?? defaultPermissionsForRole("arquitecto"));
  const [active, setActive] = useState(user?.active ?? true);
  const [saving, setSaving] = useState(false);

  function changeRole(nextRole: Role) {
    setRole(nextRole);
    setPermissions(defaultPermissionsForRole(nextRole));
  }

  function toggleView(section: ViewSection) {
    if (permissions.edit.some(entity => editDependencies[entity]?.includes(section))) return;
    const enabled = permissions.view.includes(section);
    setPermissions(current => ({
      view: enabled ? current.view.filter(value => value !== section) : [...current.view, section],
      edit: enabled && entities.includes(section as Entity) ? current.edit.filter(value => value !== section) : current.edit,
    }));
  }

  function toggleEdit(entity: Entity) {
    const enabled = permissions.edit.includes(entity);
    const dependencies = editDependencies[entity] || [];
    setPermissions(current => ({
      view: enabled ? current.view : [...new Set([...current.view, entity, ...dependencies])],
      edit: enabled ? current.edit.filter(value => value !== entity) : [...current.edit, entity],
    }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const payload: UserPayload = {
      name: String(form.get("name")),
      email: String(form.get("email")),
      role,
      active,
      permissions,
    };
    if (!user) payload.password = String(form.get("password"));
    const saved = await onSave(payload);
    if (!saved) setSaving(false);
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar"/>
    <section className="modal user-modal" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
      <header>
        <div className="modal-title-wrap"><span className="modal-heading-icon"><KeyRound/></span><div><p className="eyebrow">{user ? "EDITAR ACCESO" : "NUEVA CUENTA"}</p><h2 id="user-modal-title">{user ? user.name : "Crear usuario"}</h2><small>Cuenta, rol y alcance de acceso</small></div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X/></button>
      </header>
      <form onSubmit={submit}>
        <div className="user-form-grid">
          <label>Nombre<input name="name" defaultValue={user?.name} required minLength={2} autoFocus/></label>
          <label>Correo<input name="email" type="email" defaultValue={user?.email} required/></label>
          {!user && <label>Contraseña inicial<input name="password" type="password" required minLength={8}/></label>}
          <label>Rol<select value={role} onChange={event => changeRole(event.target.value as Role)}>{ROLES.map(value => <option value={value} key={value}>{roleLabels[value]}</option>)}</select></label>
          {user && <label className="account-state">Estado de la cuenta<button type="button" className={active ? "toggle active" : "toggle"} onClick={() => setActive(value => !value)}><i/>{active ? "Activo" : "Inactivo"}</button></label>}
        </div>
        <div className="permission-heading"><div><h3>Acceso por sección</h3><p>“Editar” incluye crear y modificar datos. La eliminación completa sigue reservada a Gerencia.</p></div><button type="button" onClick={() => setPermissions(defaultPermissionsForRole(role))}>Restablecer según rol</button></div>
        <div className="permission-table" role="table" aria-label="Permisos por sección">
          <div className="permission-row permission-header" role="row"><span>Sección</span><span>Ver</span><span>Editar</span></div>
          {viewSections.map(section => {
            const entity = entities.includes(section as Entity) ? section as Entity : null;
            const requiredByEdit = permissions.edit.some(editable => editDependencies[editable]?.includes(section));
            return <div className="permission-row" role="row" key={section}>
              <span>{viewSectionLabels[section]}{entity && <small>{entityLabels[entity]}</small>}</span>
              <button type="button" className={permissions.view.includes(section) ? "permission-check checked" : "permission-check"} onClick={() => toggleView(section)} disabled={requiredByEdit} title={requiredByEdit ? "Necesario para editar una sección relacionada" : undefined} aria-label={`${permissions.view.includes(section) ? "Quitar" : "Dar"} permiso para ver ${viewSectionLabels[section]}`} aria-pressed={permissions.view.includes(section)}>{permissions.view.includes(section) && <Check/>}</button>
              {entity ? <button type="button" className={permissions.edit.includes(entity) ? "permission-check checked" : "permission-check"} onClick={() => toggleEdit(entity)} aria-label={`${permissions.edit.includes(entity) ? "Quitar" : "Dar"} permiso para editar ${viewSectionLabels[section]}`} aria-pressed={permissions.edit.includes(entity)}>{permissions.edit.includes(entity) && <Check/>}</button> : <span className="read-only-label">Solo lectura</span>}
            </div>;
          })}
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={saving}><UserRoundCheck size={17}/>{saving ? "Guardando…" : user ? "Guardar cambios" : "Crear usuario"}</button></footer>
      </form>
    </section>
  </div>;
}

function initials(name: string) { return name.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase(); }
