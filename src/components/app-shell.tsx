"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3, ChevronDown, CircleDollarSign, CreditCard, FileText, HandCoins, HardHat,
  Landmark, LayoutDashboard, ListTodo, LogOut, Menu, ReceiptText, Settings, ShoppingCart,
  Truck, Users, WalletCards, X,
} from "lucide-react";
import { roleLabels, type Role } from "@/lib/constants";

type NavItem = { href: string; label: string; icon: LucideIcon; managerOnly?: boolean };
type NavGroup = { id: string; label: string; icon: LucideIcon; items: NavItem[] };

const dashboardItem: NavItem = { href: "/app", label: "Tablero gerencial", icon: LayoutDashboard };
const groups: NavGroup[] = [
  { id: "commercial", label: "Comercial", icon: CircleDollarSign, items: [
    { href: "/app/clients", label: "Clientes", icon: Users },
    { href: "/app/quotes", label: "Ventas y cotizaciones", icon: FileText },
  ] },
  { id: "works", label: "Obras", icon: HardHat, items: [
    { href: "/app/works", label: "Obras", icon: HardHat },
    { href: "/app/tasks", label: "Tareas", icon: ListTodo },
  ] },
  { id: "purchases", label: "Compras", icon: ShoppingCart, items: [
    { href: "/app/suppliers", label: "Proveedores", icon: Truck },
    { href: "/app/purchases", label: "Órdenes de compra", icon: ShoppingCart },
    { href: "/app/expenses", label: "Compras y gastos", icon: ReceiptText },
  ] },
  { id: "finance", label: "Finanzas", icon: WalletCards, items: [
    { href: "/app/invoices", label: "Facturación", icon: FileText },
    { href: "/app/collections", label: "Cobranzas", icon: HandCoins },
    { href: "/app/payments", label: "Pagos", icon: CreditCard },
    { href: "/app/checks", label: "Cheques", icon: Landmark },
    { href: "/app/cash", label: "Caja y bancos", icon: WalletCards },
  ] },
];

const directItems: NavItem[] = [
  { href: "/app/reports", label: "Reportes", icon: BarChart3 },
  { href: "/app/settings", label: "Usuarios", icon: Settings, managerOnly: true },
];

const allItems = [dashboardItem, ...groups.flatMap(group => group.items), ...directItems];

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === href : pathname.startsWith(href);
}

function groupForPath(pathname: string) {
  return groups.find(group => group.items.some(item => isActive(pathname, item.href)))?.id ?? null;
}

export function AppShell({ session, children }: { session: { name: string; email: string; role: Role }; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(() => groupForPath(pathname));

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
          <Link href="/app" className="brand" aria-label="Ir al tablero">
            <Image className="brand-logo" src="/brand/pino-logo.png" width={46} height={46} alt="" priority />
            <span><b>Pino</b><small>Soluciones Técnicas</small></span>
          </Link>
          <button className="icon-btn mobile" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"><X /></button>
        </div>

        <nav aria-label="Navegación principal">
          <p className="nav-caption">GESTIÓN</p>
          <Link href={dashboardItem.href} className={pathname === "/app" ? "nav-link active" : "nav-link"} onClick={() => setMobileOpen(false)}>
            <dashboardItem.icon size={19} /><span>{dashboardItem.label}</span>
          </Link>

          {groups.map(group => {
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
          {directItems.filter(item => !item.managerOnly || session.role === "gerencia").map(item => {
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
