"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox, PackagePlus, ArrowLeftRight, BarChart3, BookOpen, BookText, Boxes, Building2, CalendarDays, CarFront, ChevronDown, CircleDollarSign, ClipboardList, CreditCard, Database, FileClock, FileText, HandCoins, HardHat, Landmark, LayoutDashboard, Library, ListTodo, LogOut, Menu, PackageOpen, ReceiptText, Route, ScanBarcode, Settings, ShieldCheck, ShoppingCart, Store, Tags, Truck, Users, WalletCards, X, PackageSearch, Calculator, Banknote, ScrollText } from "lucide-react";
import { roleLabels, type Role, type ViewSection } from "@/lib/constants";
import { canViewSection, type UserPermissions } from "@/lib/permissions";
import { saveNavVersion, type NavVersion } from "@/lib/nav-version";
import { NotificationBell } from "@/components/notification-bell";
import { TasksButton } from "@/components/tasks-button";

type NavItem = { href: string; label: string; icon: LucideIcon; permission?: ViewSection; managerOnly?: boolean };
type NavGroup = { id: string; label: string; icon: LucideIcon; items: NavItem[] };

/*
 * La barra azul, con los módulos en el orden que pidió administración:
 * Maestros, Comercial, Obras, Compras, Ventas, Stock y logística, Personal,
 * Tesorería, Contabilidad y Gestión.
 * Cada módulo muestra todo lo que hace falta para su trabajo, en el orden en
 * que se usa (en Compras: proveedor, precios, orden, remito, factura, pago).
 * Por eso una pantalla puede estar en más de un módulo: Clientes está en
 * Maestros y en Ventas, las órdenes de pago en Compras y en Tesorería.
 * Un módulo sin nada que la persona pueda ver no aparece.
 */
const dashboardItem: NavItem = { href: "/app", label: "Tablero gerencial", icon: LayoutDashboard, permission: "dashboard" };
const clientsItem: NavItem = { href: "/app/clients", label: "Clientes", icon: Users, permission: "clients" };
const suppliersItem: NavItem = { href: "/app/suppliers", label: "Proveedores", icon: Truck, permission: "suppliers" };
const accountsItem: NavItem = { href: "/app/accounts", label: "Plan de cuentas", icon: BookOpen, permission: "accounts" };
const quotesItem: NavItem = { href: "/app/quotes", label: "Cotizaciones", icon: FileText, permission: "quotes" };
const trackingItem: NavItem = { href: "/app/seguimiento", label: "Seguimiento", icon: Route, permission: "invoices" };
const collectionsItem: NavItem = { href: "/app/collections", label: "Cobranzas y recibos", icon: HandCoins, permission: "collections" };
const paymentsItem: NavItem = { href: "/app/payments", label: "Órdenes de pago y pagos", icon: CreditCard, permission: "payments" };
const workOutputsItem: NavItem = { href: "/app/salidas", label: "Salidas a obra", icon: HardHat, permission: "stock" };
const groups: NavGroup[] = [
  { id: "masters", label: "Maestros", icon: Database, items: [
    clientsItem,
    suppliersItem,
    accountsItem,
  ] },
  { id: "commercial", label: "Comercial", icon: CircleDollarSign, items: [
    quotesItem,
    trackingItem,
    { href: "/app/calendario", label: "Calendario", icon: CalendarDays, permission: "calendario" },
  ] },
  { id: "works", label: "Obras", icon: HardHat, items: [
    { href: "/app/works", label: "Obras", icon: HardHat, permission: "works" },
    { href: "/app/tasks", label: "Tareas y pendientes", icon: ListTodo, permission: "tasks" },
    { ...workOutputsItem, icon: PackageOpen },
  ] },
  // El circuito de la compra, de arriba hacia abajo. Tesorería busca las
  // órdenes de pago junto a las facturas que pagan (reunión del 10/11/2026).
  { id: "purchases", label: "Compras", icon: ShoppingCart, items: [
    suppliersItem,
    { href: "/app/precios", label: "Buscador de precios", icon: Tags, permission: "suppliers" },
    { href: "/app/purchases", label: "Solicitudes y órdenes", icon: ClipboardList, permission: "purchases" },
    { href: "/app/remitos-compra", label: "Remitos de compra", icon: PackagePlus, permission: "purchases" },
    { href: "/app/expenses", label: "Facturas de compra", icon: ReceiptText, permission: "expenses" },
    paymentsItem,
    { href: "/app/ruta-compras", label: "Ruta de compras", icon: Route, permission: "purchases" },
  ] },
  // El circuito de la venta: cliente, cotización o mostrador, remito, factura y cobro.
  { id: "sales", label: "Ventas", icon: Store, items: [
    clientsItem,
    quotesItem,
    { href: "/app/mostrador", label: "Mostrador (venta al público)", icon: Store, permission: "invoices" },
    { href: "/app/remitos", label: "Remitos de venta", icon: PackageOpen, permission: "stock" },
    { href: "/app/invoices", label: "Facturas de venta", icon: ReceiptText, permission: "invoices" },
    collectionsItem,
    trackingItem,
  ] },
  { id: "stock", label: "Stock y logística", icon: Boxes, items: [
    { href: "/app/stock", label: "Stock", icon: PackageSearch, permission: "stock" },
    { href: "/app/caja", label: "Caja (entradas y salidas)", icon: ScanBarcode, permission: "stock" },
    workOutputsItem,
    { href: "/app/transferencias", label: "Transferencias", icon: ArrowLeftRight, permission: "stock" },
    { href: "/app/envios", label: "Envíos por transporte", icon: Truck, permission: "stock" },
  ] },
  { id: "staff", label: "Personal", icon: Users, items: [
    { href: "/app/workers", label: "Personal", icon: Users, permission: "workers" },
    { href: "/app/liquidacion", label: "Liquidación de quincena", icon: Calculator, permission: "workers" },
  ] },
  // La plata: lo que entra, lo que sale, dónde está y los bienes de la empresa.
  { id: "treasury", label: "Tesorería", icon: Landmark, items: [
    { href: "/app/cash", label: "Caja y bancos", icon: WalletCards, permission: "cash" },
    collectionsItem,
    paymentsItem,
    { href: "/app/checks", label: "Cheques", icon: Banknote, permission: "checks" },
    { href: "/app/extracto", label: "Extracto por caja", icon: ScrollText, permission: "cashAccounts" },
    { href: "/app/cashAccounts", label: "Cajas y cuentas bancarias", icon: Landmark, permission: "cashAccounts" },
    { href: "/app/assets", label: "Bienes de uso", icon: CarFront, permission: "assets" },
  ] },
  { id: "accounting", label: "Contabilidad", icon: Library, items: [
    accountsItem,
    { href: "/app/libro-iva", label: "Libro IVA", icon: BookText, permission: "accounting" },
    { href: "/app/mayor", label: "Movimientos por cuenta", icon: ScrollText, permission: "accounting" },
  ] },
  { id: "management", label: "Gestión", icon: LayoutDashboard, items: [
    dashboardItem,
    { href: "/app/bandeja", label: "Bandeja de pendientes", icon: Inbox },
    { href: "/app/reports", label: "iA y Reportes", icon: BarChart3, permission: "reports" },
  ] },
];

/*
 * El menú de antes (v1), para quien lo prefiera: el tablero arriba, cuatro
 * grupos y el análisis al pie. Las pantallas que se sumaron con los módulos
 * entran en el grupo que les queda más cerca.
 */
const legacyGroups: NavGroup[] = [
  { id: "commercial", label: "Comercial", icon: CircleDollarSign, items: [
    { href: "/app/clients", label: "Clientes", icon: Users, permission: "clients" },
    { href: "/app/quotes", label: "Ventas y cotizaciones", icon: FileText, permission: "quotes" },
    { href: "/app/mostrador", label: "Mostrador (venta al público)", icon: Store, permission: "invoices" },
    { href: "/app/remitos", label: "Remitos de venta", icon: PackageOpen, permission: "stock" },
  ] },
  { id: "works", label: "Obras", icon: HardHat, items: [
    { href: "/app/works", label: "Obras", icon: HardHat, permission: "works" },
    { href: "/app/workers", label: "Personal asignado", icon: Users, permission: "workers" },
    { href: "/app/liquidacion", label: "Liquidación de quincena", icon: Calculator, permission: "workers" },
    { href: "/app/tasks", label: "Tareas y pendientes", icon: ListTodo, permission: "tasks" },
  ] },
  { id: "purchases", label: "Compras y stock", icon: ShoppingCart, items: [
    { href: "/app/stock", label: "Stock", icon: PackageSearch, permission: "stock" },
    { href: "/app/caja", label: "Caja (entradas y salidas)", icon: ScanBarcode, permission: "stock" },
    { href: "/app/salidas", label: "Salidas a obra", icon: HardHat, permission: "stock" },
    { href: "/app/transferencias", label: "Transferencias", icon: ArrowLeftRight, permission: "stock" },
    { href: "/app/envios", label: "Envíos por transporte", icon: Truck, permission: "stock" },
    { href: "/app/suppliers", label: "Proveedores", icon: Truck, permission: "suppliers" },
    { href: "/app/precios", label: "Buscador de precios", icon: Tags, permission: "suppliers" },
    { href: "/app/purchases", label: "Órdenes de compra", icon: ShoppingCart, permission: "purchases" },
    { href: "/app/remitos-compra", label: "Remitos de compra", icon: PackagePlus, permission: "purchases" },
    { href: "/app/ruta-compras", label: "Ruta de compras", icon: Route, permission: "purchases" },
    { href: "/app/expenses", label: "Compras y gastos", icon: ReceiptText, permission: "expenses" },
    { href: "/app/assets", label: "Bienes de uso", icon: CarFront, permission: "assets" },
  ] },
  { id: "finance", label: "Finanzas", icon: WalletCards, items: [
    { href: "/app/seguimiento", label: "Seguimiento", icon: Route, permission: "invoices" },
    { href: "/app/invoices", label: "Facturación", icon: FileText, permission: "invoices" },
    { href: "/app/collections", label: "Cobranzas y recibos", icon: HandCoins, permission: "collections" },
    { href: "/app/payments", label: "Pagos", icon: CreditCard, permission: "payments" },
    { href: "/app/cash", label: "Caja y bancos", icon: WalletCards, permission: "cash" },
    { href: "/app/cashAccounts", label: "Cajas y cuentas bancarias", icon: Landmark, permission: "cashAccounts" },
    { href: "/app/extracto", label: "Extracto por caja", icon: ScrollText, permission: "cashAccounts" },
    { href: "/app/checks", label: "Cheques", icon: Banknote, permission: "checks" },
    { href: "/app/accounts", label: "Plan de cuentas", icon: BookOpen, permission: "accounts" },
    { href: "/app/libro-iva", label: "Libro IVA", icon: BookText, permission: "accounting" },
    { href: "/app/mayor", label: "Movimientos por cuenta", icon: ScrollText, permission: "accounting" },
  ] },
];
const legacyAnalysis: NavItem[] = [{ href: "/app/reports", label: "iA y Reportes", icon: BarChart3, permission: "reports" }];

const calendarItem: NavItem = { href: "/app/calendario", label: "Calendario", icon: CalendarDays, permission: "calendario" };
const profileGroups: NavGroup[] = [
  { id: "config", label: "Configuración", icon: Settings, items: [
    { href: "/app/config", label: "Empresas y comprobantes", icon: Building2, managerOnly: true },
  ] },
  { id: "security", label: "Seguridad", icon: ShieldCheck, items: [
    { href: "/app/settings", label: "Usuarios y permisos", icon: Users, managerOnly: true },
    { href: "/app/audit", label: "Bitácora de cambios", icon: FileClock, managerOnly: true },
  ] },
];
const profileItems = [calendarItem, ...profileGroups.flatMap(group => group.items)];
const allItems = groups.flatMap(group => group.items);
const legacyItems = [dashboardItem, ...legacyGroups.flatMap(group => group.items), ...legacyAnalysis];

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/app" && pathname.startsWith(`${href}/`));
}

function groupForPath(pathname: string, version: NavVersion = "v2") {
  return (version === "v1" ? legacyGroups : groups).find(group => group.items.some(item => isActive(pathname, item.href)))?.id ?? null;
}

export function AppShell({ session, navVersion, children }: { session: { name: string; email: string; role: Role; permissions: UserPermissions }; navVersion: NavVersion; children: React.ReactNode }) {
  const pathname = usePathname();
  const [version, setVersion] = useState<NavVersion>(navVersion);
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
  const [expanded, setExpanded] = useState<string | null>(() => groupForPath(pathname, navVersion));
  const canSee = (item: NavItem) => (!item.managerOnly || session.role === "gerencia") && (!item.permission || canViewSection(session, item.permission));
  const visibleGroups = (version === "v1" ? legacyGroups : groups).map(group => ({ ...group, items: group.items.filter(canSee) })).filter(group => group.items.length);
  const homeHref = canViewSection(session, "dashboard") ? "/app" : visibleGroups[0]?.items[0]?.href ?? "/app";

  /** Cambia de menú y lo recuerda en este navegador por un año. */
  function chooseVersion(next: NavVersion) {
    saveNavVersion(next);
    setVersion(next);
    setExpanded(groupForPath(pathname, next));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const current = (version === "v1" ? legacyItems : allItems).find(item => isActive(pathname, item.href))
    ?? profileItems.find(item => isActive(pathname, item.href))
    ?? dashboardItem;
  const initials = session.name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase();

  function renderProfileLink({ href, label, icon: Icon }: NavItem) {
    return (
      <Link key={href} href={href} className="profile-menu-link" aria-current={isActive(pathname, href) ? "page" : undefined} onClick={() => setProfileOpen(false)}>
        <Icon size={16} /> {label}
      </Link>
    );
  }

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
          {version === "v1" && <>
            <p className="nav-caption">GESTIÓN</p>
            {canSee(dashboardItem) && <Link href={dashboardItem.href} className={pathname === "/app" ? "nav-link active" : "nav-link"} onClick={() => setMobileOpen(false)}>
              <dashboardItem.icon size={19} /><span>{dashboardItem.label}</span>
            </Link>}
          </>}
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

          {/* Con el menú de antes, el análisis va pegado al pie de la barra. */}
          {version === "v1" && legacyAnalysis.some(canSee) && <div className="nav-secondary">
            <p className="nav-caption nav-caption-secondary">ANÁLISIS</p>
            {legacyAnalysis.filter(canSee).map(item => {
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "nav-link active" : "nav-link"} onClick={() => setMobileOpen(false)}><Icon size={19} /><span>{item.label}</span></Link>;
            })}
          </div>}
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
            <button className="profile" onClick={() => setProfileOpen(value => !value)} aria-label={`Menú de perfil de ${session.name}`} aria-expanded={profileOpen}>
              <span className="avatar">{initials}</span>
              <span className="profile-name"><b>{session.name}</b><small>{roleLabels[session.role]}</small></span>
              <ChevronDown className={profileOpen ? "chevron open" : "chevron"} size={16} />
            </button>
            {profileOpen && <div className="profile-menu">
              <p>{session.email}</p>
              <div className="nav-version" role="group" aria-label="Menú lateral">
                <span>Menú</span>
                {(["v1", "v2"] as const).map(option => <button key={option} type="button" className={version === option ? "active" : ""} aria-pressed={version === option} onClick={() => chooseVersion(option)} title={option === "v1" ? "El menú de antes: Comercial, Obras, Compras y stock, Finanzas" : "El menú por módulos"}>{option.toUpperCase()}</button>)}
              </div>
              {canSee(calendarItem) && renderProfileLink(calendarItem)}
              {profileGroups.map(({ id, label, icon: Icon, items }) => {
                const visibleItems = items.filter(canSee);
                if (!visibleItems.length) return null;
                return (
                  <div className="profile-menu-group" key={id} role="group" aria-labelledby={`profile-${id}`}>
                    <span className="profile-menu-group-label" id={`profile-${id}`}><Icon size={14} /> {label}</span>
                    {visibleItems.map(renderProfileLink)}
                  </div>
                );
              })}
              <button onClick={logout}><LogOut size={16} /> Cerrar sesión</button>
            </div>}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
      {mobileOpen && <button className="backdrop" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú" />}
    </div>
  );
}
