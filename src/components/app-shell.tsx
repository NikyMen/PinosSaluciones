"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Users, FileText, HardHat, Truck, ReceiptText, HandCoins, CreditCard, Landmark, ListTodo, BarChart3, Menu, X, LogOut, ChevronDown, Settings, ShoppingCart, WalletCards } from "lucide-react";
import { roleLabels, type Role } from "@/lib/constants";

const nav = [
  ["/app", "Inicio", LayoutDashboard], ["/app/clients", "Clientes", Users], ["/app/quotes", "Ventas", FileText], ["/app/works", "Obras", HardHat],
  ["/app/suppliers", "Proveedores", Truck], ["/app/purchases", "Órdenes de compra", ShoppingCart], ["/app/expenses", "Compras y gastos", ReceiptText], ["/app/invoices", "Facturación", FileText],
  ["/app/collections", "Cobranzas", HandCoins], ["/app/payments", "Pagos", CreditCard], ["/app/checks", "Cheques", Landmark], ["/app/cash", "Caja y bancos", WalletCards],
  ["/app/tasks", "Tareas", ListTodo], ["/app/reports", "Reportes", BarChart3],
  ["/app/settings", "Usuarios", Settings],
] as const;

export function AppShell({ session, children }: { session: { name: string; email: string; role: Role }; children: React.ReactNode }) {
  const pathname = usePathname(); const router = useRouter(); const [open, setOpen] = useState(false); const [profile, setProfile] = useState(false);
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }
  return <div className="app-shell"><aside className={open ? "sidebar open" : "sidebar"}><div className="sidebar-head"><Link href="/app" className="brand"><span className="brand-mark">PS</span><span><b>Pinos</b><small>Gestión integral</small></span></Link><button className="icon-btn mobile" onClick={() => setOpen(false)}><X/></button></div><nav>{nav.filter(([href])=>href!=="/app/settings"||session.role==="gerencia").map(([href, label, Icon]) => { const active = href === "/app" ? pathname === href : pathname.startsWith(href); return <Link key={href} href={href} className={active ? "active" : ""} onClick={() => setOpen(false)}><Icon size={19}/><span>{label}</span></Link>; })}</nav><div className="sidebar-foot"><span className="status-dot"/> Sistema operativo</div></aside><div className="main-wrap"><header className="topbar"><button className="icon-btn mobile" onClick={() => setOpen(true)}><Menu/></button><div className="top-spacer"/><div className="profile-wrap"><button className="profile" onClick={() => setProfile(!profile)}><span className="avatar">{session.name.split(" ").map(x => x[0]).join("").slice(0,2)}</span><span className="profile-name"><b>{session.name}</b><small>{roleLabels[session.role]}</small></span><ChevronDown size={16}/></button>{profile && <div className="profile-menu"><p>{session.email}</p><button onClick={logout}><LogOut size={16}/> Cerrar sesión</button></div>}</div></header><main className="content">{children}</main></div>{open && <button className="backdrop" onClick={() => setOpen(false)}/>}</div>;
}
