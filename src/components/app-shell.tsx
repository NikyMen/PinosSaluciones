"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeftRight, BarChart3, BookOpen, BookText, Boxes, Building2, CalendarDays, CarFront, ChevronDown, CircleDollarSign, ClipboardList, CreditCard, Database, FileClock, FileText, HandCoins, HardHat, Landmark, LayoutDashboard, Library, ListTodo, LogOut, Menu, PackageOpen, ReceiptText, Route, ScanBarcode, Settings, ShieldCheck, ShoppingCart, Store, Tags, Truck, Users, WalletCards, X, PackageSearch, Calculator, Banknote, ScrollText } from "lucide-react";
import { roleLabels, type Role, type ViewSection } from "@/lib/constants";
import { canViewSection, type UserPermissions } from "@/lib/permissions";
import { NotificationBell } from "@/components/notification-bell";
import { TasksButton } from "@/components/tasks-button";

type NavItem = { href: string; label: string; icon: LucideIcon; permission?: ViewSection; managerOnly?: boolean };
type NavGroup = { id: string; label: string; icon: LucideIcon; items: NavItem[] };

/*
 * La barra azul, con los módulos en el orden que pidió administración:
 * Configuración, Seguridad, Maestros, Comercial, Obras, Compras, Ventas,
 * Stock y logística, Personal, Activos, Tesorería, Contabilidad y Gestión.
 * Un módulo sin nada que la persona pueda ver no aparece.
 */
const dashboardItem: NavItem = { href: "/app", label: "Tablero gerencial", icon: LayoutDashboard, permission: "dashboard" };
const settingsItem: NavItem = { href: "/app/settings", label: "Usuarios y permisos", icon: Users, managerOnly: true };
const groups: NavGroup[] = [
  { id: "config", label: "Configuración", icon: Settings, items: [
    { href: "/app/config", label: "Empresas y comprobantes", icon: Building2, managerOnly: true },
  ] },
  { id: "security", label: "Seguridad", icon: ShieldCheck, items: [
    settingsItem,
    { href: "/app/audit", label: "Bitácora de cambios", icon: FileClock, managerOnly: true },
  ] },
  { id: "masters", label: "Maestros", icon: Database, items: [
    { href: "/app/clients", label: "Clientes", icon: Users, permission: "clients" },
    { href: "/app/suppliers", label: "Proveedores", icon: Truck, permission: "suppliers" },
    { href: "/app/accounts", label: "Plan de cuentas", icon: BookOpen, permission: "accounts" },
  ] },
  { id: "commercial", label: "Comercial", icon: CircleDollarSign, items: [
    { href: "/app/quotes", label: "Cotizaciones", icon: FileText, permission: "quotes" },
    { href: "/app/seguimiento", label: "Seguimiento", icon: Route, permission: "invoices" },
    { href: "/app/calendario", label: "Calendario", icon: CalendarDays, permission: "calendario" },
  ] },
  { id: "works", label: "Obras", icon: HardHat, items: [
    { href: "/app/works", label: "Obras", icon: HardHat, permission: "works" },
    { href: "/app/tasks", label: "Tareas y pendientes", icon: ListTodo, permission: "tasks" },
  ] },
  { id: "purchases", label: "Compras", icon: ShoppingCart, items: [
    { href: "/app/purchases", label: "Solicitudes y órdenes", icon: ClipboardList, permission: "purchases" },
    { href: "/app/precios", label: "Buscador de precios", icon: Tags, permission: "suppliers" },
    { href: "/app/expenses", label: "Facturas de compra", icon: ReceiptText, permission: "expenses" },
    { href: "/app/ruta-compras", label: "Ruta de compras", icon: Route, permission: "purchases" },
  ] },
  { id: "sales", label: "Ventas", icon: Store, items: [
    { href: "/app/remitos", label: "Remitos de venta", icon: PackageOpen, permission: "stock" },
    { href: "/app/invoices", label: "Facturas de venta", icon: FileText, permission: "invoices" },
    { href: "/app/collections", label: "Cobranzas y recibos", icon: HandCoins, permission: "collections" },
  ] },
  { id: "stock", label: "Stock y logística", icon: Boxes, items: [
    { href: "/app/stock", label: "Stock", icon: PackageSearch, permission: "stock" },
    { href: "/app/caja", label: "Caja (entradas y salidas)", icon: ScanBarcode, permission: "stock" },
    { href: "/app/transferencias", label: "Transferencias", icon: ArrowLeftRight, permission: "stock" },
  ] },
  { id: "staff", label: "Personal", icon: Users, items: [
    { href: "/app/workers", label: "Personal", icon: Users, permission: "workers" },
    { href: "/app/liquidacion", label: "Liquidación de quincena", icon: Calculator, permission: "workers" },
  ] },
  { id: "assets", label: "Activos", icon: CarFront, items: [
    { href: "/app/assets", label: "Bienes de uso", icon: CarFront, permission: "assets" },
  ] },
  { id: "treasury", label: "Tesorería", icon: Landmark, items: [
    { href: "/app/cash", label: "Caja y bancos", icon: WalletCards, permission: "cash" },
    { href: "/app/checks", label: "Cheques", icon: Banknote, permission: "checks" },
    { href: "/app/payments", label: "Órdenes de pago y pagos", icon: CreditCard, permission: "payments" },
  ] },
  { id: "accounting", label: "Contabilidad", icon: Library, items: [
    { href: "/app/libro-iva", label: "Libro IVA", icon: BookText, permission: "accounting" },
    { href: "/app/mayor", label: "Movimientos por cuenta", icon: ScrollText, permission: "accounting" },
  ] },
  { id: "management", label: "Gestión", icon: LayoutDashboard, items: [
    dashboardItem,
    { href: "/app/reports", label: "iA y Reportes", icon: BarChart3, permission: "reports" },
  ] },
];

const allItems = groups.flatMap(group => group.items);

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === href : pathname.startsWith(href);
}

function groupForPath(pathname: string) {
  return groups.find(group => group.items.some(item => isActive(pathname, item.href)))?.id ?? null;
}

export function AppShell({ session, children }: { session: { name: string; email: string; role: Role; permissions: UserPermissions }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // El menú del usuario se cierra al tocar afuera o con Escape, igual que la campanita.
  useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (event: MouseEvent) => { if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setProfileOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [profileOpen]);
  const [expanded, setExpanded] = useState<string | null>(() => groupForPath(pathname));
  const canSee = (item: NavItem) => (!item.managerOnly || session.role === "gerencia") && (!item.permission || canViewSection(session, item.permission));
  const visibleGroups = groups.map(group => ({ ...group, items: group.items.filter(canSee) })).filter(group => group.items.length);
  const homeHref = canViewSection(session, "dashboard") ? "/app" : visibleGroups[0]?.items[0]?.href ?? "/app";

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const current = allItems.find(item => isActive(pathname, item.href)) ?? dashboardItem;
  const initials = session.name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="app-shell">
      <aside className={mobileOpen ? "sidebar open" : "sidebar"}>
        <div className="sidebar-head">
          <Link href={homeHref} className="brand" aria-label="Ir al inicio">
            <Image className="brand-logo" src="/brand/pino-logo.png" width={46} height={46} alt="" priority />
            <span><b>Pino</b><small>Soluciones Técnicas</small></span>
          </Link>
          <button className="icon-btn mobile" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"><X /></button>
        </div>

        <nav aria-label="Navegación principal">
          {visibleGroups.map(group => {
            const groupActive = group.items.some(item => isActive(pathname, item.href));
            const open = expanded === group.id;
            const GroupIcon = group.icon;
            return (
              <div className={groupActive ? "nav-group active" : "nav-group"} key={group.id}>
                <button className="nav-group-trigger" onClick={() => setExpanded(open ? null : group.id)} aria-expanded={open} aria-controls={`nav-${group.id}`}>
                  <GroupIcon size={19} /><span>{group.label}</span><ChevronDown className={open ? "chevron open" : "chevron"} size={16} />
                </button>
                <div className={open ? "nav-children open" : "nav-children"} id={`nav-${group.id}`}>
                  {group.items.map(item => {
                    const Icon = item.icon;
                    return <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "active" : ""} onClick={() => setMobileOpen(false)}><Icon size={16} /><span>{item.label}</span></Link>;
                  })}
                </div>
              </div>
            );
          })}

        </nav>

      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <button className="icon-btn mobile" onClick={() => setMobileOpen(true)} aria-label="Abrir menú"><Menu /></button>
          <div className="topbar-context"><span>Pino Gestión</span><b>{current.label}</b></div>
          <div className="top-spacer" />
          <TasksButton />
          <NotificationBell />
          <div className="profile-wrap" ref={profileRef}>
            <button className="profile" onClick={() => setProfileOpen(value => !value)} aria-expanded={profileOpen}>
              <span className="avatar">{initials}</span>
              <span className="profile-name"><b>{session.name}</b><small>{roleLabels[session.role]}</small></span>
              <ChevronDown className={profileOpen ? "chevron open" : "chevron"} size={16} />
            </button>
            {profileOpen && <div className="profile-menu"><p>{session.email}</p>
              {session.role === "gerencia" && <Link href={settingsItem.href} className="profile-menu-link" onClick={() => setProfileOpen(false)}><Settings size={16} /> {settingsItem.label}</Link>}
              <button onClick={logout}><LogOut size={16} /> Cerrar sesión</button></div>}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
      {mobileOpen && <button className="backdrop" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú" />}
    </div>
  );
}
