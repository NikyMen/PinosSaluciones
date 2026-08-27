"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3, ChevronDown, CircleDollarSign, CreditCard, FileText, HandCoins, HardHat,
  Landmark, LayoutDashboard, ListTodo, LogOut, Menu, ReceiptText, Settings, ShoppingCart,
  Truck, Users, WalletCards, X, PackageSearch,
} from "lucide-react";
import { roleLabels, type Role, type ViewSection } from "@/lib/constants";
import { canViewSection, type UserPermissions } from "@/lib/permissions";
import { NotificationBell } from "@/components/notification-bell";
import { TasksButton } from "@/components/tasks-button";

type NavItem = { href: string; label: string; icon: LucideIcon; permission?: ViewSection; managerOnly?: boolean };
type NavGroup = { id: string; label: string; icon: LucideIcon; items: NavItem[] };

const dashboardItem: NavItem = { href: "/app", label: "Tablero gerencial", icon: LayoutDashboard, permission: "dashboard" };
const groups: NavGroup[] = [
  { id: "commercial", label: "Comercial", icon: CircleDollarSign, items: [
    { href: "/app/clients", label: "Clientes", icon: Users, permission: "clients" },
    { href: "/app/quotes", label: "Ventas y cotizaciones", icon: FileText, permission: "quotes" },
  ] },
  { id: "works", label: "Obras", icon: HardHat, items: [
    { href: "/app/works", label: "Obras", icon: HardHat, permission: "works" },
    { href: "/app/workers", label: "Trabajadores", icon: Users, permission: "workers" },
    { href: "/app/tasks", label: "Tareas y pendientes", icon: ListTodo, permission: "tasks" },
  ] },
  { id: "purchases", label: "Compras y stock", icon: ShoppingCart, items: [
    { href: "/app/stock", label: "Stock", icon: PackageSearch, permission: "stock" },
    { href: "/app/suppliers", label: "Proveedores", icon: Truck, permission: "suppliers" },
    { href: "/app/purchases", label: "Órdenes de compra", icon: ShoppingCart, permission: "purchases" },
    { href: "/app/expenses", label: "Compras y gastos", icon: ReceiptText, permission: "expenses" },
  ] },
  { id: "finance", label: "Finanzas", icon: WalletCards, items: [
    { href: "/app/invoices", label: "Facturación", icon: FileText, permission: "invoices" },
    { href: "/app/collections", label: "Cobranzas", icon: HandCoins, permission: "collections" },
    { href: "/app/payments", label: "Pagos", icon: CreditCard, permission: "payments" },
    { href: "/app/checks", label: "Cheques", icon: Landmark, permission: "checks" },
    { href: "/app/cash", label: "Caja y bancos", icon: WalletCards, permission: "cash" },
  ] },
];

const directItems: NavItem[] = [
  { href: "/app/reports", label: "iA y Reportes", icon: BarChart3, permission: "reports" },
  { href: "/app/settings", label: "Usuarios", icon: Settings, managerOnly: true },
];

const allItems = [dashboardItem, ...groups.flatMap(group => group.items), ...directItems];

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
  const [expanded, setExpanded] = useState<string | null>(() => groupForPath(pathname));
  const visibleGroups = groups.map(group => ({ ...group, items: group.items.filter(item => !item.permission || canViewSection(session, item.permission)) })).filter(group => group.items.length);
  const visibleDirectItems = directItems.filter(item => (!item.managerOnly || session.role === "gerencia") && (!item.permission || canViewSection(session, item.permission)));
  const homeHref = canViewSection(session, "dashboard") ? "/app" : visibleGroups[0]?.items[0]?.href ?? visibleDirectItems[0]?.href ?? "/app";

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
          <p className="nav-caption">GESTIÓN</p>
          {canViewSection(session, "dashboard") && <Link href={dashboardItem.href} className={pathname === "/app" ? "nav-link active" : "nav-link"} onClick={() => setMobileOpen(false)}>
            <dashboardItem.icon size={19} /><span>{dashboardItem.label}</span>
          </Link>}

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

          <p className="nav-caption nav-caption-secondary">ANÁLISIS</p>
          {visibleDirectItems.map(item => {
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} className={isActive(pathname, item.href) ? "nav-link active" : "nav-link"} onClick={() => setMobileOpen(false)}><Icon size={19} /><span>{item.label}</span></Link>;
          })}
        </nav>

        <div className="sidebar-foot"><span className="status-dot" /><span><b>Sistema operativo</b><small>Datos actualizados</small></span></div>
      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <button className="icon-btn mobile" onClick={() => setMobileOpen(true)} aria-label="Abrir menú"><Menu /></button>
          <div className="topbar-context"><span>Pino Gestión</span><b>{current.label}</b></div>
          <div className="top-spacer" />
          <TasksButton />
          <NotificationBell />
          <div className="profile-wrap">
            <button className="profile" onClick={() => setProfileOpen(value => !value)} aria-expanded={profileOpen}>
              <span className="avatar">{initials}</span>
              <span className="profile-name"><b>{session.name}</b><small>{roleLabels[session.role]}</small></span>
              <ChevronDown className={profileOpen ? "chevron open" : "chevron"} size={16} />
            </button>
            {profileOpen && <div className="profile-menu"><p>{session.email}</p><button onClick={logout}><LogOut size={16} /> Cerrar sesión</button></div>}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
      {mobileOpen && <button className="backdrop" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú" />}
    </div>
  );
}
