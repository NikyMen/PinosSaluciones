"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, MailCheck, MailWarning, Pencil, Plus, Send, ShieldCheck, UserRoundCheck, X } from "lucide-react";
import { entities, entityLabels, ROLES, roleLabels, viewSections, viewSectionLabels, type Entity, type Role, type ViewSection } from "@/lib/constants";
import { defaultPermissionsForRole, type UserPermissions } from "@/lib/permissions";
import { dateTime } from "@/lib/format";

/** `pending`: la invitación está mandada pero todavía no eligió su contraseña. */
type User = { _id: string; name: string; email: string; role: Role; active: boolean; permissions: UserPermissions; pending?: boolean; inviteExpiresAt?: string | null };
type UserPayload = { name: string; email: string; role: Role; active: boolean; permissions: UserPermissions };
type Invite = { link: string; sent: boolean; error: string; expiresAt: string; kind: "invite" | "reset" };
type InviteNotice = { name: string; email: string; invite: Invite };

const editDependencies: Partial<Record<Entity, ViewSection[]>> = {
  quotes: ["clients"], works: ["clients", "quotes"], purchases: ["suppliers", "works"], expenses: ["suppliers", "works"],
  invoices: ["clients", "works"], collections: ["clients", "invoices"], payments: ["suppliers", "expenses"], checks: ["clients", "suppliers"],
};

export function UsersAdmin() {
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<User | "new" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<InviteNotice | null>(null);
  const [sending, setSending] = useState("");

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
    // Al crear la cuenta sale la invitación: se muestra si llegó a mandarse y el link por las dudas.
    if (isNew && result.invite) setNotice({ name: result.name, email: result.email, invite: result.invite });
    await load();
    return true;
  }

  /** Reenvía la invitación o, si ya tiene contraseña, le manda el link para cambiarla. */
  async function sendLink(user: User) {
    setError(""); setNotice(null); setSending(user._id);
    const response = await fetch(`/api/users/${user._id}/invite`, { method: "POST" });
    const result = await response.json();
    setSending("");
    if (!response.ok) return setError(result.error || "No se pudo mandar el link");
    setNotice({ name: user.name, email: user.email, invite: result });
    await load();
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
    {notice && <InviteNoticeBox notice={notice} onClose={() => setNotice(null)} />}
    <section className="panel users-panel">
      <div className="panel-head"><div><h2>Equipo</h2><p>{users.filter(user => user.active).length} cuentas activas · {users.length} totales</p></div><ShieldCheck/></div>
      <div className="user-list">
        {users.map(user => <div key={user._id}>
          <span className="avatar">{initials(user.name)}</span>
          <div><b>{user.name}{user.pending && <em className={inviteExpired(user) ? "user-invite-badge expired" : "user-invite-badge"}>{inviteExpired(user) ? "Invitación vencida" : "Invitación pendiente"}</em>}</b><small>{user.email} · {roleLabels[user.role]}</small><span className="user-access-summary">{user.permissions.view.length} secciones · {user.permissions.edit.length} editables{user.pending && user.inviteExpiresAt && !inviteExpired(user) ? ` · el link vence el ${dateTime(user.inviteExpiresAt)}` : ""}</span></div>
          {user.active && <button className="user-edit-btn" disabled={sending === user._id} onClick={() => { void sendLink(user); }}
            title={user.pending ? "Mandar de nuevo el correo para que cree su contraseña" : "Mandarle un link por correo para que elija una contraseña nueva"}>
            {user.pending ? <><Send size={15}/> {sending === user._id ? "Enviando…" : "Reenviar invitación"}</> : <><KeyRound size={15}/> {sending === user._id ? "Enviando…" : "Cambiar contraseña"}</>}
          </button>}
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
          <label>Rol<select value={role} onChange={event => changeRole(event.target.value as Role)}>{ROLES.map(value => <option value={value} key={value}>{roleLabels[value]}</option>)}</select></label>
          {user && <label className="account-state">Estado de la cuenta<button type="button" className={active ? "toggle active" : "toggle"} onClick={() => setActive(value => !value)}><i/>{active ? "Activo" : "Inactivo"}</button></label>}
        </div>
        {!user && <p className="user-invite-hint"><MailCheck size={17}/><span>No hace falta poner contraseña: al crear la cuenta le llega un correo a esta dirección con un link para que la elija. El link vence en 7 días y se puede reenviar desde la lista.</span></p>}
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
        <footer><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={saving}><UserRoundCheck size={17}/>{saving ? "Guardando…" : user ? "Guardar cambios" : "Crear usuario e invitar"}</button></footer>
      </form>
    </section>
  </div>;
}

function inviteExpired(user: User) {
  return Boolean(user.inviteExpiresAt) && new Date(String(user.inviteExpiresAt)).getTime() < Date.now();
}

/**
 * Cómo salió el envío del link. Si el correo no salió, el link queda a mano
 * para copiarlo y mandarlo por WhatsApp.
 */
function InviteNoticeBox({ notice, onClose }: { notice: InviteNotice; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const { invite } = notice;
  const what = invite.kind === "invite" ? "crear su contraseña" : "elegir una contraseña nueva";
  async function copy() {
    try { await navigator.clipboard.writeText(invite.link); setCopied(true); }
    catch { setCopied(false); }
  }
  return <div className={invite.sent ? "notice success invite-notice" : "notice invite-notice warning"} role="status">
    {invite.sent ? <MailCheck size={19}/> : <MailWarning size={19}/>}
    <div>
      <b>{invite.sent ? `Le mandamos el correo a ${notice.email}` : `No se pudo mandar el correo a ${notice.email}`}</b>
      <p>{invite.sent
        ? `${notice.name} va a recibir un link para ${what}. Vence el ${dateTime(invite.expiresAt)}. Si no le llega, revisá la carpeta de spam o copiale el link.`
        : `${invite.error} Copiá el link y mandáselo a ${notice.name} por WhatsApp: con él va a poder ${what}. Vence el ${dateTime(invite.expiresAt)}.`}</p>
      <div className="invite-link"><input readOnly value={invite.link} aria-label="Link para crear la contraseña" onFocus={event => event.currentTarget.select()}/><button type="button" className="secondary-btn" onClick={() => { void copy(); }}><Copy size={15}/> {copied ? "Copiado" : "Copiar link"}</button></div>
    </div>
    <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar aviso"><X size={17}/></button>
  </div>;
}

function initials(name: string) { return name.split(" ").filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase(); }
