"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRightLeft, FileSymlink, Tag, Tags, Wrench, PackageCheck, PackagePlus, BriefcaseBusiness, Calculator, CalendarDays, Check, CheckCircle2, ClipboardCheck, Download, Edit3, Eye, FileCheck2, FileSpreadsheet, HandCoins, HardHat, History, UserMinus, UserPlus, ListTodo, Percent, Plus, Search, Timer, Trash2, TriangleAlert, Upload, UserRound, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROLES, roleLabels, type Entity, type Role } from "@/lib/constants";
import { entityConfig, columnLabels, type Field } from "@/lib/entity-config";
import { date, dateTime, money, qty, titleCase } from "@/lib/format";
import { DateInput } from "@/components/fields";
import { HistoryModal, RecordHistory } from "@/components/record-history";
import { FormField, QuickCreateModal, fieldErrors, type FieldProps } from "@/components/record-form";
import { StockMovementModal, type StockItem, type StockMovement } from "@/components/stock-movement";
import { PurchaseDetailModal } from "@/components/purchase-detail";
import { purchaseStatusText } from "@/lib/purchase-flow-labels";
import { levelsOf } from "@/lib/stock-levels";
import { ownerLabels, ownersOf, ownerTotals, type OwnerKey } from "@/lib/stock-owners";
import { WAREHOUSES, warehouseLabel, type WarehouseKey } from "@/lib/warehouses";
import { InvoiceWorkModal, currentPeriod, type InvoiceableWork } from "@/components/work-invoice";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { downloadFiscalInvoicePdf, fiscalInvoicePdfData } from "@/lib/fiscal-invoice-pdf";
import { readPdfLogo } from "@/lib/pdf-brand";
import { downloadPurchaseOrderPdf, purchaseOrderPdfData } from "@/lib/purchase-order-pdf";
import { downloadQuotePdf, quotePdfData } from "@/lib/quote-pdf";
import { WorkerLaborModal } from "@/components/worker-labor-modal";
import { InvoiceFields } from "@/components/invoice-fields";
import { WorkerStatusModal } from "@/components/worker-status-modal";
import { WorkTypesModal } from "@/components/work-types-modal";
import { ReceiptModal } from "@/components/receipt-modal";
import { downloadReceiptPdf, methodLabels } from "@/lib/receipt-pdf";
import { invoiceLabel, voucherLabels } from "@/lib/invoice-labels";
import { companyOf } from "@/lib/companies";
import { AssetMaintenanceModal, NextDueCell, type AssetRecord } from "@/components/asset-maintenance";
import { CashTransferModal } from "@/components/cash-transfer";
import { meterLabels, sectorLabels } from "@/lib/assets";
import { printLabels, readPrinterSettings } from "@/lib/ticket-print";
import { fetchAllRecords } from "@/lib/fetch-all-records";
import { netFromGross } from "@/lib/net-amounts";

type Item = Record<string, unknown> & { _id: string };

// Modulos donde la fila entera abre el formulario. En obras la fila lleva a la
// pantalla de la obra (lo mismo que "Abrir obra"); el formulario queda en el lápiz.
const inlineEntities = new Set<Entity>(["tasks", "quotes"]);
// Donde ademas el estado se cambia sin entrar. En cotizaciones no: ahi el
// estado lo mueve el formulario y "aprobada" solo sale del boton Aprobar.
// Una orden de pago se marca pagada desde la lista.
// El estado de una compra no se elige: lo mueven sus acciones (emitir, autorizar, la orden de pago, los remitos).
const inlineStatusEntities = new Set<Entity>(["works", "tasks", "payments"]);

// Estados desde los que todavia tiene sentido aprobar una cotizacion.
const approvable = new Set(["borrador", "enviada", "seguimiento", "vencida"]);

/** Etiqueta corta de un registro, para títulos y para el buscador de los selects. */
/** Los períodos de una persona en la empresa, cada uno con el legajo que tuvo. */
function WorkerPeriods({ worker }: { worker: Item }) {
  const history = Array.isArray(worker.fileHistory) ? worker.fileHistory as Array<{ fileNumber?: number; from?: string; to?: string; reason?: string }> : [];
  const current = worker.active !== false ? [{ fileNumber: Number(worker.fileNumber || 0), from: String(worker.activeSince || worker.createdAt || ""), to: "", reason: "" }] : [];
  const periods = [...history.map(period => ({ fileNumber: Number(period.fileNumber || 0), from: String(period.from || ""), to: String(period.to || ""), reason: String(period.reason || "") })), ...current];
  if (!periods.length) return null;
  return <div className="modal-form-body worker-periods"><p className="eyebrow">PERÍODOS EN LA EMPRESA</p><ul>
    {periods.map((period, index) => <li key={index}><b>Legajo {period.fileNumber || "—"}</b><span>{period.from ? `desde el ${date(period.from)}` : ""}{period.to ? ` hasta el ${date(period.to)}` : " · actual"}</span>{period.reason && <small>{period.reason}</small>}</li>)}
  </ul></div>;
}

/** El módulo de la barra donde vive cada sección: es el título chico de arriba. */
const moduleOf: Record<Entity, string> = {
  clients: "MAESTROS", suppliers: "MAESTROS", accounts: "MAESTROS", quotes: "COMERCIAL", works: "OBRAS", tasks: "OBRAS",
  purchases: "COMPRAS", expenses: "COMPRAS", invoices: "VENTAS", collections: "VENTAS", stock: "STOCK Y LOGÍSTICA",
  workers: "PERSONAL", assets: "ACTIVOS", cash: "TESORERÍA", checks: "TESORERÍA", payments: "TESORERÍA", cashAccounts: "TESORERÍA",
};

const feminine = new Set(["factura", "obra", "cotización", "orden", "tarea", "orden de pago", "cuenta", "factura de compra", "caja o cuenta", "solicitud"]);

function itemLabel(item: Item) {
  // Una cotización se reconoce por su número: "COT-12 · Fachada 9 de Julio".
  if (item.number && item.title) return `${String(item.number)} · ${String(item.title)}`;
  return String(item.name || item.title || item.number || item.code || item.description || "Registro");
}

export type Viewer = { userId: string; role: Role };

/** Quién de la empresa puede aparecer como responsable de una tarea. */
type Person = { _id: string; name: string; role: Role };

export function EntityManager({ entity, canEdit, canDeleteRecords, viewer }: { entity: Entity; canEdit: boolean; canDeleteRecords: boolean; viewer: Viewer }) {
  const baseConfig = entityConfig[entity];
  // El tipo de trabajo del personal se elige de la tabla de tarifas, que se carga aparte.
  const [workTypes, setWorkTypes] = useState<string[]>([]);
  const [ratesOpen, setRatesOpen] = useState(false);
  const loadWorkTypes = useCallback(() => {
    void fetch("/api/work-types")
      .then(response => response.ok ? response.json() : { items: [] })
      .then((result: { items?: Array<{ name: string; active?: boolean }> }) => setWorkTypes((result.items || []).filter(type => type.active !== false).map(type => type.name)))
      .catch(() => setWorkTypes([]));
  }, []);
  // Bienes de uso: qué sector se mira; por defecto todos.
  const [sectorView, setSectorView] = useState("");
  const config = useMemo(() => entity !== "workers" ? baseConfig : { ...baseConfig, fields: baseConfig.fields.map(field => field.key === "workType" ? { ...field, options: workTypes } : field) }, [entity, baseConfig, workTypes]);
  // Stock, obras y clientes no se borran de una: van a la papelera y dejan de contar en los números.
  const hasTrash = entity === "stock" || entity === "works" || entity === "clients";
  // "Nueva factura", "Nueva obra", "Nuevo recibo".
  const newLabel = `${feminine.has(config.singular) ? "Nueva" : "Nuevo"} ${config.singular}`;
  const isAdmin = viewer.role === "gerencia";
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [relations, setRelations] = useState<Record<string, Item[]>>({});
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  // Con qué viene cargado un registro nuevo (la factura: su número y, desde un certificado, sus datos).
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState("");
  const [error, setError] = useState("");
  // Valor elegido en cada select de relación, para poder cambiarlo desde el alta rápida.
  const [relationValues, setRelationValues] = useState<Record<string, string>>({});
  const [quickCreate, setQuickCreate] = useState<{ fieldKey: string; entity: Entity } | null>(null);
  const [historyFor, setHistoryFor] = useState<{ _id: string; label: string } | null>(null);
  const [laborFor, setLaborFor] = useState<{ _id: string; label: string } | null>(null);
  const [movementFor, setMovementFor] = useState<{ item: StockItem; kind: StockMovement["kind"] } | null>(null);
  // La ficha de una compra: la solicitud con su orden, sus pagos y sus remitos.
  const [purchaseFor, setPurchaseFor] = useState<string | null>(null);
  // Compras: solicitudes, órdenes o todas.
  const [purchaseView, setPurchaseView] = useState<"" | "solicitud" | "orden">("");
  const [convertFor, setConvertFor] = useState<Item | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<Item | null>(null);
  const [statusFor, setStatusFor] = useState<Item | null>(null);
  // El bien de uso cuyo mantenimiento está abierto.
  const [maintenanceFor, setMaintenanceFor] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  // El recibo abierto: uno para editar, o uno nuevo (desde una factura viene con su cliente y la factura).
  const [receiptFor, setReceiptFor] = useState<{ receipt: Item | null; clientId?: string; invoiceId?: string } | null>(null);
  // Estado elegido en una fila que todavía espera el visto bueno.
  const [pendingStatus, setPendingStatus] = useState<{ id: string; status: string } | null>(null);
  // Filtros de Tareas: el atajo elegido y, para gerencia, área y persona.
  // Qué depósito se mira en el stock; por defecto los dos.
  const [warehouseView, setWarehouseView] = useState<"" | WarehouseKey>("");
  const [trashOpen, setTrashOpen] = useState(false);
  // El pase entre cuentas propias de Caja y bancos.
  const [transferOpen, setTransferOpen] = useState(false);
  const [taskScope, setTaskScope] = useState<"" | "mine" | "area">("");
  const [taskRole, setTaskRole] = useState("");
  const [taskPerson, setTaskPerson] = useState("");
  const [people, setPeople] = useState<Person[]>([]);

  const taskQuery = useMemo(() => {
    if (entity !== "tasks") return "";
    const params = new URLSearchParams();
    if (taskScope) params.set("scope", taskScope);
    if (isAdmin && taskRole) params.set("assigneeRole", taskRole);
    if (isAdmin && taskPerson) params.set("assigneeId", taskPerson);
    return params.toString();
  }, [entity, taskScope, taskRole, taskPerson, isAdmin]);

  const load = useCallback(async () => {
    // Al recargar, un cambio de estado a medio confirmar no queda colgado.
    setPendingStatus(null);
    setLoading(true);
    const response = await fetch(`/api/records/${entity}?limit=100&search=${encodeURIComponent(search)}${taskQuery ? `&${taskQuery}` : ""}`);
    const result = await response.json();
    if (response.ok) { setItems(result.items); setError(""); }
    else setError(result.error || "No se pudieron cargar los registros");
    setLoading(false);
  }, [entity, search, taskQuery]);

  // La espera es sólo mientras se tipea en el buscador: al entrar a la sección la lista se pide de una.
  useEffect(() => { const timer = setTimeout(load, search ? 250 : 0); return () => clearTimeout(timer); }, [load, search]);
  const relationEntities = useMemo(() => [...new Set(config.fields.filter(field => field.relation).map(field => field.relation!))], [config.fields]);

  useEffect(() => {
    // Todos los registros, no la primera página: el select y la columna tienen que encontrar cualquiera.
    Promise.all(relationEntities.map(async relation => [relation, await fetchAllRecords<Item>(relation)] as const))
      .then(values => setRelations(Object.fromEntries(values)));
  }, [relationEntities]);

  useEffect(() => {
    if (entity === "workers") loadWorkTypes();
  }, [entity, loadWorkTypes]);

  useEffect(() => {
    if (entity !== "tasks") return;
    void fetch("/api/users/directory")
      .then(response => response.ok ? response.json() as Promise<{ items?: Person[] }> : { items: [] })
      .then(result => setPeople(result.items || []))
      .catch(() => setPeople([]));
  }, [entity]);

  useEffect(() => {
    if (!modal) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !quickCreate) setModal(false); };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previous; };
  }, [modal, quickCreate]);

  function relationLabel(field: string, value: unknown) {
    const definition = config.fields.find(candidate => candidate.key === field);
    const row = definition?.relation ? relations[definition.relation]?.find(candidate => candidate._id === String(value)) : null;
    return row ? itemLabel(row) : value ? "…" : "—";
  }

  function display(key: string, value: unknown, item: Item) {
    if (entity === "assets" && key === "sector") return <span className={`sector-badge ${String(value || "general")}`}>{sectorLabels[String(value || "general")] || "General"}</span>;
    // Lo que hay en cada depósito: un material viejo no tiene el campo y todo lo suyo está en el Central.
    // El último precio va con la fecha de la lista (o de la compra) de donde sale.
    // Un recibo puede cancelar varias facturas.
    if (entity === "collections" && key === "invoiceId" && Array.isArray(item.allocations) && item.allocations.length > 1) return `${item.allocations.length} facturas`;
    if (entity === "collections" && key === "method") return methodLabels[String(value)] || titleCase(String(value || ""));
    // El legajo, y si la persona está dada de baja, se ve ahí mismo.
    if (entity === "workers" && key === "fileNumber") return <span className="file-number"><b>{value ? String(value) : "—"}</b>{item.active === false && <span className="badge anulada" title={item.leftAt ? `Baja el ${date(String(item.leftAt))}` : "Dada de baja"}>Baja</span>}</span>;
    if (entity === "purchases" && key === "stage") return value === "solicitud" ? "Solicitud" : "Orden de compra";
    if (entity === "purchases" && key === "status") return <span className={`badge purchase-${String(value || "")}`}>{purchaseStatusText(item)}</span>;
    if (entity === "purchases" && key === "number") return <span className="invoice-number">{String(value || "—")}{item.legacyNumber ? <small> · antes {String(item.legacyNumber)}</small> : null}</span>;
    if (entity === "invoices" && key === "number") return <span className="invoice-number">{String(value || "—").replace(/^X-/, "")}{item.replacedById ? <small> · sustituida</small> : item.replacesId ? <small> · sustituye una X</small> : null}</span>;
    if (key === "company") { const company = companyOf(value); return <span className={`company-badge ${company.key}`} title={`${company.legalName} · CUIT ${company.cuit}`}>{company.short}</span>; }
    if (key === "voucherType" && value === "factura_x") return <span className="voucher-x" title="Comprobante interno: no pasa por ARCA ni va al libro IVA">Factura X</span>;
    if (key === "voucherType") return value ? voucherLabels[String(value)] || titleCase(String(value)) : "—";
    if (entity === "assets" && key === "nextDueDate") return <NextDueCell item={item} />;
    if (entity === "assets" && key === "currentReading") return value != null && item.meterUnit && item.meterUnit !== "ninguno" ? `${qty(Number(value), 0)} ${meterLabels[String(item.meterUnit)] || ""}` : "—";
    // Los selects con nombre propio para cada opción (Vehículo, Informática) se leen igual en la tabla.
    const labels = config.fields.find(field => field.key === key)?.optionLabels;
    if (key === "status" && value) return <span className={`badge ${value}`}>{labels?.[String(value)] ?? titleCase(String(value))}</span>;
    if (entity === "accounts" && key === "active") return <span className={`badge ${value === false ? "anulada" : "activo"}`}>{value === false ? "Desactivada" : "Activa"}</span>;
    if (entity === "accounts" && key === "code") return <span className="account-code">{String(value || "")}</span>;
    if (labels && value) return labels[String(value)] ?? titleCase(String(value));
    if (key === "lastPriceCents") return item.lastPriceDate ? <span className="cell-stack">{money(Number(value || 0))}<small>{item.lastPriceSource === "compra" ? "Compra" : "Lista"} del {date(String(item.lastPriceDate))}</small></span> : "—";
    if (key.startsWith("qty_")) { const amount = levelsOf(item)[key.slice(4) as WarehouseKey] ?? 0; return amount ? qty(amount) : "—"; }
    if (key === "quantity" && entity === "stock") return qty(Number(value || 0));
    if (entity === "stock" && (key === "transitQty" || key === "reservedQty")) return Number(value || 0) ? <span className={key === "reservedQty" ? "cell-stack" : ""}>{qty(Number(value))}{key === "reservedQty" && <small>Disponible {qty(Math.max(0, levelsOf(item).central + levelsOf(item).salon - Number(value)))}</small>}</span> : "—";
    // De qué empresa es lo que hay (CUIT propietario), sumando todas las ubicaciones.
    if (entity === "stock" && key === "owners") { const totals = ownerTotals(ownersOf(item)); const entries = (Object.entries(totals) as Array<[OwnerKey, number]>).filter(([, amount]) => amount > 0); return entries.length ? <span className="owner-split">{entries.map(([owner, amount]) => <span key={owner} className={`owner-chip ${owner}`} title={ownerLabels[owner]}>{owner === "sin_asignar" ? "s/a" : companyOf(owner).short.replace("Constructora Pino", "CP").replace("TV Pino", "TVP")} {qty(amount)}</span>)}</span> : "—"; }
    if (key.endsWith("Cents")) return money(Number(value || 0));
    if (key === "phones") return Array.isArray(value) && value.length ? value.join(" · ") : "—";
    if (key === "minQuantity") return Number(value || 0) || "—";
    if (key === "discountPct") return Number(value || 0) ? `${qty(Number(value))} %` : "—";
    if (key.toLowerCase().includes("date") || key === "validUntil") return date(value as string);
    if (key.endsWith("Id")) return relationLabel(key, value);
    if (key === "status" || key === "type" || key === "method" || key === "direction" || key === "assigneeRole") return <span className={`badge ${value}`}>{titleCase(String(value || ""))}</span>;
    return value ? String(value) : "—";
  }

  function open(item?: Item, defaults: Record<string, unknown> = {}) {
    if (!canEdit) return;
    // Un cobro es un recibo: tiene su propia ventana, con las facturas del cliente.
    if (entity === "collections") { setReceiptFor({ receipt: item || null }); return; }
    setEditing(item || null);
    setDraft(item ? {} : defaults);
    setRelationValues(Object.fromEntries(config.fields.filter(field => field.relation || field.type === "user").map(field => [field.key, String(item?.[field.key] ?? defaults[field.key] ?? "")])));
    setModal(true);
    setError("");
  }

  /** Alta nueva. La factura se abre con el número que sigue al último. */
  async function openCreate() {
    if (entity !== "invoices") return open();
    const response = await fetch("/api/invoices/draft").catch(() => null);
    open(undefined, response?.ok ? await response.json() as Record<string, unknown> : {});
  }

  // El aviso "Certificado listo para facturar" llega con ?obra=&certificado=, y "Facturar" desde los
  // remitos de venta con ?remitos=: se abre la factura ya cargada.
  useEffect(() => {
    if (entity !== "invoices" || !canEdit) return;
    const params = new URLSearchParams(window.location.search);
    const obra = params.get("obra"); const certificado = params.get("certificado"); const remitos = params.get("remitos");
    if (!(obra && certificado) && !remitos) return;
    router.replace("/app/invoices");
    void fetch(`/api/invoices/draft?${new URLSearchParams(remitos ? { remitos } : { obra: obra!, certificado: certificado! }).toString()}`)
      .then(response => response.ok ? response.json() as Promise<Record<string, unknown>> : {})
      .then(defaults => open(undefined, defaults), () => open());
    // Solo al entrar: después la dirección ya quedó limpia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, canEdit]);

  // Un aviso de compras llega con ?ver=: se abre la ficha de la compra.
  useEffect(() => {
    if (entity !== "purchases") return;
    const id = new URLSearchParams(window.location.search).get("ver");
    if (!id) return;
    router.replace("/app/purchases");
    const timer = window.setTimeout(() => setPurchaseFor(id), 0);
    return () => window.clearTimeout(timer);
    // Solo al entrar: después la dirección ya quedó limpia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  // "Cargar factura" desde la ficha de una OC llega con ?oc=: la factura ya atada a la orden.
  useEffect(() => {
    if (entity !== "expenses" || !canEdit) return;
    const orderId = new URLSearchParams(window.location.search).get("oc");
    if (!orderId) return;
    router.replace("/app/expenses");
    void fetch(`/api/records/purchases/${orderId}`)
      .then(response => response.ok ? response.json() as Promise<Item> : null)
      .then(order => open(undefined, order ? {
        purchaseId: order._id, company: order.company, supplierId: order.supplierId, workId: order.workId, voucherType: "factura_a",
        category: "materiales", issueDate: new Date().toISOString().slice(0, 10), description: String(order.description || ""),
      } : {}), () => open());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, canEdit]);

  // "Orden de pago" desde una factura de compra llega con ?factura=: se abre la OP ya cargada con su saldo.
  useEffect(() => {
    if (entity !== "payments" || !canEdit) return;
    const expenseId = new URLSearchParams(window.location.search).get("factura");
    if (!expenseId) return;
    router.replace("/app/payments");
    void fetch(`/api/records/expenses/${expenseId}`)
      .then(response => response.ok ? response.json() as Promise<Item> : null)
      .then(expense => open(undefined, expense ? {
        company: expense.company, supplierId: expense.supplierId, expenseId: expense._id, status: "emitida",
        date: new Date().toISOString().slice(0, 10), dueDate: expense.dueDate,
        amountCents: Math.max(0, Number(expense.amountCents || 0) - Number(expense.paidCents || 0)),
        accountId: expense.accountId, notes: `Factura ${String(expense.number || "")} · ${String(expense.description || "")}`.trim(),
      } : {}), () => open());
    // Solo al entrar: después la dirección ya quedó limpia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, canEdit]);

  /** La cotización para el cliente. El listado no trae los ítems: se pide entera, con su cliente. */
  async function downloadQuote(item: Item) {
    try {
      const [quote, client] = await Promise.all([
        fetch(`/api/records/quotes/${item._id}`).then(response => response.ok ? response.json() : Promise.reject(new Error("quote"))),
        item.clientId ? fetch(`/api/records/clients/${String(item.clientId)}`).then(response => response.ok ? response.json() : null).catch(() => null) : null,
      ]);
      await downloadQuotePdf(quotePdfData(quote, client || relations.clients?.find(row => row._id === String(item.clientId || ""))));
    } catch { setError("No se pudo generar el PDF de la cotización"); }
  }

  /** La factura emitida en ARCA, con CAE y QR. El cliente se pide entero: hace falta su condición de IVA. */
  async function downloadInvoice(item: Item) {
    const read = (path: string) => fetch(path).then(response => response.ok ? response.json() : null).catch(() => null);
    const [client, associated] = await Promise.all([
      item.clientId ? read(`/api/records/clients/${String(item.clientId)}`) : null,
      item.associatedInvoiceId ? read(`/api/records/invoices/${String(item.associatedInvoiceId)}`) : null,
    ]);
    await downloadFiscalInvoicePdf(fiscalInvoicePdfData(item, client || relations.clients?.find(row => row._id === String(item.clientId || "")), associated))
      .catch(() => setError("No se pudo generar el PDF de la factura"));
  }

  async function downloadReceipt(item: Item) {
    const response = await fetch(`/api/receipts/${item._id}`);
    if (!response.ok) return setError("No se pudo armar el recibo");
    await downloadReceiptPdf(await response.json()).catch(() => setError("No se pudo generar el PDF del recibo"));
  }

  /** Etiqueta del material para la ticketera. Si no tiene código de barras, se le genera uno propio. */
  async function printStockLabel(item: Item) {
    let code = String(item.barcode || "");
    if (!code) {
      const response = await fetch("/api/stock/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ itemId: item._id, generate: true }) });
      const result = await response.json();
      if (!response.ok) return setError(result.error || "No se pudo generar el código");
      code = String(result.barcode);
      setItems(current => current.map(row => row._id === item._id ? { ...row, barcode: code } : row));
    }
    await printLabels([{ name: String(item.name || ""), code, unit: String(item.unit || "") }], readPrinterSettings().width).catch(() => setError("No se pudo abrir la impresión"));
  }

  async function remove(item: Item) {
    if (!confirm(hasTrash ? `¿Mandar "${itemLabel(item)}" a la papelera? Deja de contar en los números y se puede restaurar desde ahí.` : `¿Eliminar este ${config.singular}? Esta acción quedará auditada.`)) return;
    const response = await fetch(`/api/records/${entity}/${item._id}`, { method: "DELETE" });
    if (response.ok) void load(); else setError((await response.json()).error);
  }

  /**
   * Cambiar un estado desde el listado no se aplica de una: el select deja el
   * valor nuevo a la vista y al lado aparece el visto para confirmarlo. Un
   * `confirm()` del navegador se contesta que sí sin leerlo; esto obliga a
   * mirar a qué estado va antes de que quede guardado.
   */
  function askStatus(item: Item, status: string) {
    if (status === String(item.status || "")) return setPendingStatus(null);
    setPendingStatus({ id: item._id, status });
  }

  /** Devuelve el registro ya guardado, o `null` si el cambio no entró. */
  async function updateStatus(item: Item, status: string) {
    setPendingStatus(null);
    const previous = item.status;
    setStatusBusy(item._id);
    setItems(current => current.map(row => row._id === item._id ? { ...row, status } : row));
    const response = await fetch(`/api/records/${entity}/${item._id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    const result = await response.json();
    if (!response.ok) {
      setItems(current => current.map(row => row._id === item._id ? { ...row, status: previous } : row));
      setError(result.error || "No se pudo cambiar el estado");
    } else setItems(current => current.map(row => row._id === item._id ? { ...row, ...result } : row));
    setStatusBusy("");
    return response.ok ? { ...item, ...result } as Item : null;
  }

  /**
   * Aprobar una cotización y, sin soltar el hilo, ofrecer pasarla a obra: el
   * pop-up sale solo con los datos a la vista. Ahí se decide si además se
   * factura un porcentaje del trabajo.
   */
  async function approveQuote(item: Item) {
    const approved = await updateStatus(item, "aprobada");
    if (approved) setConvertFor(approved);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget); const body: Record<string, unknown> = {};
    // Emitir en ARCA no tiene vuelta atrás: se confirma antes.
    if (entity === "invoices" && !editing && form.get("arcaEmit") === "1"
      && !confirm(`Se va a emitir la ${voucherLabels[String(form.get("voucherType"))] || "factura"} ${String(form.get("number") || "")} en ARCA: queda autorizada con CAE y no se puede borrar ni cambiar los importes. ¿Emitir?`)) return;
    setError(""); setSaving(true);
    for (const field of formFields) {
      if (field.readOnly) continue;
      let value: unknown = form.get(field.key);
      if (field.type === "file") {
        if (value instanceof File && value.size) {
          const upload = new FormData(); upload.set("file", value);
          const response = await fetch("/api/uploads", { method: "POST", body: upload }); const result = await response.json();
          if (!response.ok) { setSaving(false); return setError(result.error || "No se pudo subir el archivo"); }
          value = result.path;
        } else value = editing?.[field.key] || "";
      } else if (field.type === "money") value = Math.round(Number(value || 0) * 100);
      else if (field.type === "number") value = Number(value || 0);
      body[field.key] = value;
    }
    const url = editing ? `/api/records/${entity}/${editing._id}` : `/api/records/${entity}`;
    let response = await fetch(url, { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let result = await response.json();
    // Una factura que pasa de lo que queda por facturar: Gerencia la puede autorizar igual, con motivo.
    if (!response.ok && result.excess && isAdmin) {
      const reason = prompt(`${String(result.error || "")}\n\n¿Por qué se factura igual? (queda en el historial de la cotización)`);
      if (reason && reason.trim().length >= 3) {
        response = await fetch(url, { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, excessReason: reason.trim() }) });
        result = await response.json();
      }
    }
    if (!response.ok) { setSaving(false); return setError(fieldErrors(result) || result.error || "No se pudo guardar"); }
    if (entity === "invoices" && !editing && result.cae) setNotice(`Emitida en ARCA: ${invoiceLabel(result)} · CAE ${String(result.cae)}. El PDF se baja con el botón "PDF fiscal" de la lista.`);
    setSaving(false); setModal(false); void load();
  }

  async function importFile(file?: File) {
    if (!file) return; setLoading(true); setError(""); const form = new FormData(); form.set("file", file);
    const response = await fetch(`/api/import/${entity}`, { method: "POST", body: form }); const result = await response.json();
    if (!response.ok) setError(result.error); else if (result.errors?.length) setError(`Se importaron ${result.imported} de ${result.total} filas${result.updated ? ` y se actualizaron ${result.updated}` : ""}. ${result.errors.length} tuvieron errores: ${result.errors.slice(0, 3).map((row: { row: number; error: string }) => `fila ${row.row}: ${row.error}`).join(" · ")}`);
    else setNotice(`Listo: ${result.imported} ${result.imported === 1 ? "nuevo" : "nuevos"}${result.updated ? ` y ${result.updated} ${result.updated === 1 ? "actualizado" : "actualizados"}` : ""}.`);
    await load(); if (fileRef.current) fileRef.current.value = "";
  }

  const statusField = config.fields.find(field => field.key === "status");
  const statusOptions = statusField?.options || [];
  const statusLabel = (value: string) => statusField?.optionLabels?.[value] ?? titleCase(value);
  // Lo que solo tiene sentido al editar (el motivo de un cambio de cuenta) no aparece en un alta.
  const formFields = config.fields.filter(field => !field.editOnly || editing);

  /** Reemplazar una Factura X por la fiscal: se abre una factura nueva con sus datos, atada a la X. */
  async function substitute(item: Item) {
    const response = await fetch("/api/invoices/draft").catch(() => null);
    const base = response?.ok ? await response.json() as Record<string, unknown> : {};
    open(undefined, {
      ...base,
      company: item.company, voucherType: "factura_a", clientId: item.clientId, quoteId: item.quoteId, workId: item.workId,
      certificateNumber: item.certificateNumber, certificateId: item.certificateId, netCents: item.netCents || item.amountCents, vatPct: 21, issueDate: new Date().toISOString().slice(0, 10),
      description: [`Sustituye la ${String(item.number || "").replace(/^X-/, "Factura X ")}`, String(item.description || "")].filter(Boolean).join(" · "),
      replacesId: item._id, remitoIds: item.remitoIds,
    });
  }

  /** Props comunes que necesita cada campo del formulario. */
  const fieldProps = (field: Field) => ({
    field,
    // El avance se muestra, no se edita: sale de las inspecciones.
    value: editing ? editing[field.key] : draft[field.key],
    relationOptions: field.relation ? (relations[field.relation] || []).map(item => ({ value: item._id, label: itemLabel(item), hint: String(item.cuit || item.email || "") || undefined })) : [],
    relationValue: relationValues[field.key] ?? "",
    personOptions: field.type === "user" ? people.map(person => ({ value: person._id, label: person.name, hint: roleLabels[person.role] })) : [],
    onRelationChange: (value: string) => setRelationValues(current => ({ ...current, [field.key]: value })),
    onCreateRelation: field.relation ? () => setQuickCreate({ fieldKey: field.key, entity: field.relation! }) : undefined,
  });

  // Con un depósito elegido se ve solo su cantidad; con los dos, cada uno y el total.
  const columns = entity === "stock" && warehouseView ? config.columns.filter(column => column === `qty_${warehouseView}` || !(column.startsWith("qty_") || column === "quantity")) : config.columns;

  return <>
    <div className="page-heading"><div><p className="eyebrow">{moduleOf[entity]}</p><h1>{config.title}</h1><p>{config.description}</p></div>{canEdit && entity !== "stock" && <button className="primary-btn" onClick={() => { void openCreate(); }}><Plus size={18} /> {newLabel}</button>}</div>
    <div className="toolbar"><div className="search"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder={`Buscar en ${config.title.toLowerCase()}…`} /></div>{canEdit && <><input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={event => { void importFile(event.target.files?.[0]); }} /><button className="secondary-btn" onClick={() => fileRef.current?.click()}><Upload size={17} /> Importar</button></>}{hasTrash && <button className="secondary-btn" onClick={() => setTrashOpen(true)}><Trash2 size={17} /> Papelera</button>}{entity === "workers" && <button className="secondary-btn" onClick={() => setRatesOpen(true)}><Tags size={17} /> Tarifas</button>}{entity === "cash" && canEdit && <button className="secondary-btn" onClick={() => setTransferOpen(true)}><ArrowRightLeft size={17} /> Movimiento entre cuentas</button>}<a className="secondary-btn" href={`/api/reports/export?entity=${entity}${taskQuery ? `&${taskQuery}` : ""}`}><Download size={17} /> Exportar a Excel</a></div>
    {entity === "tasks" && <TaskFilters viewer={viewer} people={people} scope={taskScope} role={taskRole} person={taskPerson}
      onScope={value => { setTaskScope(value); setTaskRole(""); setTaskPerson(""); }}
      onRole={value => { setTaskRole(value); setTaskScope(""); }}
      onPerson={value => { setTaskPerson(value); setTaskScope(""); }} />}
    {error && <div className="notice error">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
    {entity === "assets" && <div className="tracking-filter asset-sectors" role="group" aria-label="Sector">
      {[["", "Todos"], ...Object.entries(sectorLabels)].map(([key, label]) => <button key={key} type="button" className={sectorView === key ? "active" : ""} aria-pressed={sectorView === key} onClick={() => setSectorView(key)}>{label}</button>)}
    </div>}
    {entity === "purchases" && <div className="tracking-filter" role="group" aria-label="Solicitudes u órdenes">
      {([["", "Todas"], ["solicitud", "Solicitudes"], ["orden", "Órdenes de compra"]] as const).map(([key, label]) => <button key={key} type="button" className={purchaseView === key ? "active" : ""} aria-pressed={purchaseView === key} onClick={() => setPurchaseView(key)}>{label}</button>)}
      <Link href="/app/remitos-compra" className="secondary-btn"><PackagePlus size={15} /> Remitos de compra</Link>
    </div>}
    {entity === "stock" && <div className="warehouse-filter" role="group" aria-label="Depósito">
      {[{ key: "" as const, label: "Ambos depósitos" }, ...WAREHOUSES].map(warehouse => <button key={warehouse.key} type="button" className={warehouseView === warehouse.key ? "active" : ""} aria-pressed={warehouseView === warehouse.key} onClick={() => setWarehouseView(warehouse.key)}>{warehouse.label}</button>)}
    </div>}
    <section className="table-panel"><div className="table-scroll"><table><thead><tr>{columns.map(column => <th key={column}>{config.columnTitles?.[column] || columnLabels[column] || column}</th>)}<th /></tr></thead><tbody>{(entity === "assets" && sectorView ? items.filter(item => (item.sector || "general") === sectorView) : entity === "purchases" && purchaseView ? items.filter(item => (item.stage === "solicitud" ? "solicitud" : "orden") === purchaseView) : items).map(item => {
      // En obras la fila lleva a la pantalla de la obra, aunque no se pueda editar. Una compra abre su ficha.
      const rowAction = entity === "works" ? () => router.push(`/app/works/${item._id}`) : entity === "assets" ? () => setMaintenanceFor(item._id) : entity === "purchases" ? () => setPurchaseFor(item._id) : inlineEntities.has(entity) && canEdit ? () => open(item) : null;
      const rowTitle = entity === "works" ? "Abrir la obra" : entity === "assets" ? "Ver el mantenimiento" : entity === "tasks" ? "Abrir detalle de la tarea" : entity === "purchases" ? "Abrir la compra: autorización, orden de pago y remitos" : "Abrir para editar";
      // Las tareas se pintan enteras según el estado: de un vistazo se ve qué falta.
      const rowClass = [rowAction ? "clickable-row" : "", entity === "tasks" ? `task-row ${String(item.status || "pendiente")}` : "", entity === "workers" && item.active === false ? "row-inactive" : ""].filter(Boolean).join(" ");
      return <tr key={item._id} className={rowClass} onClick={rowAction || undefined} onKeyDown={rowAction ? event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); rowAction(); } } : undefined} tabIndex={rowAction ? 0 : undefined} title={rowAction ? rowTitle : undefined}>
        {columns.map(column => <td key={column} data-label={config.columnTitles?.[column] || columnLabels[column] || column}>{inlineStatusEntities.has(entity) && column === "status" && canEdit ? (() => {
          const pending = pendingStatus?.id === item._id ? pendingStatus.status : "";
          return <div className="status-cell" onClick={event => event.stopPropagation()}>
            <select className={`inline-status ${pending || item.status}${pending ? " pending" : ""}`} value={pending || String(item.status || "")} disabled={statusBusy === item._id}
              onChange={event => { event.stopPropagation(); askStatus(item, event.target.value); }} aria-label={`Estado de ${itemLabel(item)}`}>
              {[...statusOptions, ...(statusOptions.includes(String(item.status || "")) || !item.status ? [] : [String(item.status)])].map(option => <option key={option} value={option}>{statusLabel(option)}</option>)}
            </select>
            {pending && <span className="status-confirm">
              <b>Queda guardado como {statusLabel(pending)}</b>
              <button type="button" className="status-confirm-yes" onClick={() => { void updateStatus(item, pending); }} aria-label={`Confirmar el cambio a ${statusLabel(pending)}`}><Check size={14} /> Confirmar</button>
              <button type="button" className="status-confirm-no" onClick={() => setPendingStatus(null)} aria-label="Dejarlo como estaba"><X size={14} /></button>
            </span>}
          </div>;
        })() : display(column, item[column], item)}</td>)}
        <td className="row-actions" onClick={event => event.stopPropagation()}>
          {entity === "works" && canEdit && <Link title="Inspeccionar obra" aria-label={`Inspeccionar ${itemLabel(item)}`} href={`/app/works/${item._id}/inspections/new`}><ClipboardCheck size={16} /></Link>}
          {entity === "works" && <Link title="Abrir obra" href={`/app/works/${item._id}`}><Eye size={16} /></Link>}
          {entity === "quotes" && <Link className="row-action-wide" title="Abrir el análisis de precios y la cascada" href={`/app/quotes/${item._id}`}><Calculator size={15} /> Costear</Link>}
          {entity === "quotes" && <button className="row-action-wide" title="Descargar la cotización en PDF para mandarla o imprimirla" onClick={() => { void downloadQuote(item); }}><Download size={15} /> PDF</button>}
          {entity === "suppliers" && <Link className="row-action-wide" title="Subir y ver las listas de precios del proveedor" href={`/app/suppliers/${item._id}`}><FileSpreadsheet size={15} /> Listas de precios</Link>}
          {entity === "purchases" && <button className="row-action-wide approve" title="La compra de punta a punta: autorizar, orden de pago, remitos" onClick={() => setPurchaseFor(item._id)}><Eye size={15} /> Ver</button>}
          {entity === "purchases" && <button className="row-action-wide" title={item.stage === "solicitud" ? "Descargar la solicitud en PDF" : "Descargar la orden de compra en PDF para mandársela al proveedor"}
            onClick={() => { void downloadPurchaseOrderPdf(purchaseOrderPdfData(item, relations.suppliers?.find(row => row._id === String(item.supplierId || "")), relations.works?.find(row => row._id === String(item.workId || "")))).catch(() => setError("No se pudo generar el PDF de la orden")); }}>
            <Download size={15} /> PDF</button>}
          {entity === "quotes" && canEdit && item.status === "aprobada" && <button className="row-action-wide convert" title="Crear la obra a partir de esta cotización" onClick={() => setConvertFor(item)}><BriefcaseBusiness size={15} /> Pasar a obra</button>}
          {entity === "quotes" && canEdit && approvable.has(String(item.status)) && <button className="row-action-wide approve" title="Marcar la cotización como aprobada" disabled={statusBusy === item._id} onClick={() => { void approveQuote(item); }}><CheckCircle2 size={15} /> Aprobar</button>}
          {entity === "stock" && canEdit && <button title="Entrada: una compra que llegó al Depósito Central" onClick={() => setMovementFor({ item: item as unknown as StockItem, kind: "ingreso" })}><ArrowDownToLine size={16} /></button>}
          {entity === "stock" && canEdit && <button title="Transferir entre el Depósito Central y el Salón de Ventas (queda en tránsito hasta que se recibe)" onClick={() => setMovementFor({ item: item as unknown as StockItem, kind: "transferencia" })}><ArrowRightLeft size={16} /></button>}
          {entity === "stock" && canEdit && <button title="Salida a obra, con remito" onClick={() => setMovementFor({ item: item as unknown as StockItem, kind: "egreso" })}><HardHat size={16} /></button>}
          {entity === "stock" && canEdit && <button title={item.barcode ? `Imprimir la etiqueta (${String(item.barcode)})` : "Generar el código de barras e imprimir la etiqueta"} onClick={() => { void printStockLabel(item); }}><Tag size={16} /></button>}
          {entity === "assets" && <button className="row-action-wide labor" title="Services, arreglos y próximos mantenimientos" onClick={() => setMaintenanceFor(item._id)}><Wrench size={15} /> Mantenimiento</button>}
          {entity === "purchases" && Boolean(item.stockedAt) && <span className="row-stocked" title={`Recibida por ${String(item.stockedByName || "")}`}><PackageCheck size={14} /> {item.receptionStatus === "parcial" ? "Recibida en parte" : "En stock"} · {warehouseLabel(String(item.stockedWarehouse || ""))}</span>}
          {entity === "invoices" && canEdit && item.voucherType === "factura_x" && !item.replacedById && item.status !== "anulada" && <button className="row-action-wide" title="Reemplazar esta X por una Factura A o B: lo cobrado pasa a la fiscal y la X deja de contar" onClick={() => { void substitute(item); }}><FileSymlink size={15} /> Sustituir</button>}
          {entity === "expenses" && canEdit && Boolean(item.voucherType) && item.status !== "pagado" && item.status !== "anulado" && <Link className="row-action-wide approve" title="Emitir la orden de pago de esta factura" href={`/app/payments?factura=${item._id}`}><HandCoins size={15} /> Orden de pago</Link>}
          {/* De la factura a lo que la originó: la cotización y la obra (con su certificado). */}
          {entity === "invoices" && Boolean(item.quoteId) && <Link className="row-action-wide" href={`/app/quotes/${String(item.quoteId)}`} title="Ver la cotización y cuánto queda por facturar"><Calculator size={15} /> Cotización</Link>}
          {entity === "invoices" && Boolean(item.workId) && <Link className="row-action-wide" href={`/app/works/${String(item.workId)}`} title={item.certificateNumber ? `Ver la obra y el certificado ${String(item.certificateNumber)}` : "Ver la obra"}><HardHat size={15} /> Obra</Link>}
          {entity === "invoices" && Array.isArray(item.remitoIds) && item.remitoIds.length > 0 && <Link className="row-action-wide" href="/app/remitos" title={`Factura ${item.remitoIds.length} remito${item.remitoIds.length === 1 ? "" : "s"} de venta`}><FileSymlink size={15} /> Remitos</Link>}
          {entity === "invoices" && Boolean(item.cae) && <button className="row-action-wide" title={`Descargar la factura emitida en ARCA (CAE ${String(item.cae)})`} onClick={() => { void downloadInvoice(item); }}><Download size={15} /> PDF fiscal</button>}
          {entity === "invoices" && canEdit && (item.status === "pendiente" || item.status === "parcial") && <button className="row-action-wide approve" title="Registrar un cobro de esta factura y hacer el recibo" onClick={() => setReceiptFor({ receipt: null, clientId: String(item.clientId || ""), invoiceId: item._id })}><HandCoins size={15} /> Cobrar</button>}
          {entity === "collections" && <button className="row-action-wide" title="Descargar el recibo en PDF" onClick={() => { void downloadReceipt(item); }}><Download size={15} /> Recibo</button>}
          {entity !== "tasks" && <button title="Ver historial de cambios" onClick={() => setHistoryFor({ _id: item._id, label: itemLabel(item) })}><History size={16} /></button>}
          {entity === "workers" && canEdit && (item.active === false
            ? <button className="row-action-wide approve" title="Vuelve a trabajar: se le da un legajo nuevo" onClick={() => setStatusFor(item)}><UserPlus size={15} /> Reactivar</button>
            : <button title="Dar de baja" aria-label={`Dar de baja a ${itemLabel(item)}`} onClick={() => setStatusFor(item)}><UserMinus size={16} /></button>)}
          {entity === "workers" && <button className="row-action-wide labor" title="Cargar horarios y ver la liquidación" onClick={() => setLaborFor({ _id: item._id, label: itemLabel(item) })}><Timer size={15} /> Horarios</button>}
          {/* Una compra emitida queda en sólo lectura: se edita y se borra sólo la solicitud en borrador. */}
          {canEdit && (entity !== "purchases" || (item.stage === "solicitud" && item.status === "borrador")) && <button title={entity === "tasks" ? "Ver y editar tarea" : "Editar"} onClick={() => open(item)}><Edit3 size={16} /></button>}
          {canDeleteRecords && (entity !== "purchases" || (item.stage === "solicitud" && item.status === "borrador")) && <button title="Eliminar" onClick={() => { void remove(item); }}><Trash2 size={16} /></button>}
        </td>
      </tr>;
    })}</tbody></table></div>{loading ? <div className="loading-state">Cargando…</div> : !items.length && <div className="empty-state compact"><p>No hay registros para mostrar.</p>{canEdit && <button onClick={() => { void openCreate(); }}>Crear {config.singular}</button>}</div>}</section>

    {modal && entity === "tasks" && <TaskModal task={editing} config={config} fieldProps={fieldProps} error={error} saving={saving} onClose={() => setModal(false)} onSubmit={submit} />}
    {modal && entity !== "tasks" && <div className="modal-layer"><button className="modal-backdrop" onClick={() => setModal(false)} aria-label="Cerrar" /><section className={`modal entity-modal ${entity === "works" ? "work-modal" : ""}`} role="dialog" aria-modal="true" aria-labelledby="entity-modal-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon">{entity === "works" ? <HardHat /> : <Edit3 />}</span><div>
        {/* En una obra manda el nombre: el título dice de qué obra se trata, no "editar registro". */}
        <p className="eyebrow">{entity === "works" && editing ? `OBRA ${String(editing.code || "")}` : editing ? "EDITAR REGISTRO" : "NUEVO REGISTRO"}</p>
        <h2 id="entity-modal-title">{entity === "works" && editing ? String(editing.name || "Obra") : editing ? `Editar ${config.singular}` : newLabel}</h2>
        <small>{entity === "works" && editing ? `Presupuesto ${money(Number(editing.budgetCents || 0))}` : entity === "works" ? "Información general, planificación y control de la obra" : `Completá los datos del ${config.singular}`}</small>
      </div></div>
      {entity === "works" && editing && <div className="modal-head-actions">
        <Link className="secondary-btn" href={`/app/works/${editing._id}#personal`}><Users size={16} /> Personal asignado</Link>
        {canEdit && <button type="button" className="primary-btn" onClick={() => setInvoiceFor(editing)}><FileCheck2 size={16} /> Facturar</button>}
      </div>}
      <button className="icon-btn" onClick={() => setModal(false)} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={submit}>
        <div className="modal-form-body">{entity === "works"
          ? <WorkFields fields={config.fields} fieldProps={fieldProps} />
          : entity === "invoices"
            ? <InvoiceFields fields={config.fields} fieldProps={fieldProps} editing={editing} draft={draft} quotes={relations.quotes || []} works={relations.works || []}
              onRelations={patch => setRelationValues(current => ({ ...current, ...patch }))} />
            : <div className="form-grid">{formFields.map((field, index) => <FormField key={field.key} {...fieldProps(field)} autoFocus={index === 0} />)}</div>}
        </div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer><span>Los cambios quedan registrados automáticamente.</span><button type="button" className="secondary-btn" onClick={() => setModal(false)}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button></footer>
      </form>
      {editing && entity === "workers" && <WorkerPeriods worker={editing} />}
      {editing && <div className="modal-form-body"><RecordHistory entity={entity} recordId={editing._id} embedded /></div>}
    </section></div>}

    {transferOpen && <CashTransferModal onClose={() => setTransferOpen(false)} onDone={message => { setTransferOpen(false); setNotice(message); void load(); }} />}
    {ratesOpen && <WorkTypesModal canEdit={canEdit} onClose={() => setRatesOpen(false)} onSaved={() => { setRatesOpen(false); setNotice("Tarifas guardadas. Valen para los partes que se carguen de ahora en adelante."); loadWorkTypes(); }} />}
    {statusFor && <WorkerStatusModal worker={statusFor} onClose={() => setStatusFor(null)} onDone={message => { setStatusFor(null); setNotice(message); void load(); }} />}

    {receiptFor && <ReceiptModal receipt={receiptFor.receipt} initialClientId={receiptFor.clientId} initialInvoiceId={receiptFor.invoiceId}
      clients={(relations.clients || []).map(client => ({ value: client._id, label: itemLabel(client), hint: String(client.cuit || "") || undefined }))}
      onClose={() => setReceiptFor(null)} onSaved={() => { setReceiptFor(null); void load(); }} />}

    {trashOpen && hasTrash && <TrashModal entity={entity} canRestore={canEdit} onClose={() => setTrashOpen(false)} onRestored={() => { void load(); }} />}

    {quickCreate && <QuickCreateModal entity={quickCreate.entity} onClose={() => setQuickCreate(null)} onCreated={item => {
      setRelations(current => ({ ...current, [quickCreate.entity]: [item, ...(current[quickCreate.entity] || [])] }));
      setRelationValues(current => ({ ...current, [quickCreate.fieldKey]: item._id }));
      setQuickCreate(null);
    }} />}

    {invoiceFor && <InvoiceWorkModal work={invoiceFor as unknown as InvoiceableWork}
      onClose={() => setInvoiceFor(null)}
      onDone={updated => { setInvoiceFor(null); setModal(false); setItems(current => current.map(row => row._id === (updated as Item)._id ? { ...row, ...updated as Item } : row)); }} />}

    {convertFor && <ConvertQuoteModal quote={convertFor} client={(relations.clients || []).find(row => row._id === String(convertFor.clientId || ""))}
      onClose={() => setConvertFor(null)} onDone={() => { setConvertFor(null); void load(); }} />}

    {purchaseFor && <PurchaseDetailModal purchaseId={purchaseFor} onClose={() => setPurchaseFor(null)} onChanged={() => { void load(); }} />}
    {movementFor && <StockMovementModal item={movementFor.item} initialKind={movementFor.kind}
      onClose={() => setMovementFor(null)}
      onSaved={updated => { setItems(current => current.map(row => row._id === updated._id ? { ...row, ...updated } as Item : row)); setMovementFor({ item: updated, kind: movementFor.kind }); }} />}

    {historyFor && <HistoryModal entity={entity} record={historyFor} onClose={() => setHistoryFor(null)} />}
    {maintenanceFor && <AssetMaintenanceModal assetId={maintenanceFor} canEdit={canEdit} onClose={() => setMaintenanceFor(null)}
      onChanged={(updated: AssetRecord) => setItems(current => current.map(row => row._id === updated._id ? { ...row, nextDueDate: updated.nextDueDate, nextDueTitle: updated.nextDueTitle, nextDueReading: updated.nextDueReading, currentReading: updated.currentReading, status: updated.status } : row))} />}
    {laborFor && <WorkerLaborModal worker={laborFor} canEdit={canEdit} onClose={() => setLaborFor(null)} />}
  </>;
}

/**
 * Filtros de Tareas.
 *
 * Todo el mundo tiene los dos atajos: lo que lleva su nombre y lo de su área.
 * Fuera de gerencia esas son además las únicas tareas que existen para esa
 * persona — el recorte lo hace el servidor, no estos botones. Gerencia ve todo
 * y encima puede mirar el tablero de otra área o de alguien en particular.
 */
function TaskFilters({ viewer, people, scope, role, person, onScope, onRole, onPerson }: {
  viewer: Viewer; people: Person[]; scope: string; role: string; person: string;
  onScope: (value: "" | "mine" | "area") => void; onRole: (value: string) => void; onPerson: (value: string) => void;
}) {
  const isAdmin = viewer.role === "gerencia";
  const all = !scope && !role && !person;
  return <div className="task-filters">
    <div className="task-filter-chips">
      <button type="button" className={all ? "active" : ""} onClick={() => onScope("")}>{isAdmin ? "Todas" : "Todo lo mío"}</button>
      <button type="button" className={scope === "mine" ? "active" : ""} onClick={() => onScope("mine")}><UserRound size={15} /> Asignadas a mí</button>
      <button type="button" className={scope === "area" ? "active" : ""} onClick={() => onScope("area")}><Users size={15} /> Mi área ({roleLabels[viewer.role]})</button>
    </div>
    {isAdmin
      ? <div className="task-filter-selects">
          <label><span>Área</span><select value={role} onChange={event => onRole(event.target.value)}>
            <option value="">Todas las áreas</option>
            {ROLES.map(option => <option key={option} value={option}>{roleLabels[option]}</option>)}
          </select></label>
          <label><span>Persona</span><select value={person} onChange={event => onPerson(event.target.value)}>
            <option value="">Cualquiera</option>
            {people.map(option => <option key={option._id} value={option._id}>{option.name}</option>)}
          </select></label>
        </div>
      : <p className="task-filter-note">Ves las tareas de tu área y las que están a tu nombre.</p>}
  </div>;
}

/**
 * Pasar una cotización a obra. Antes eran tres `prompt()` del navegador, que no
 * dejaban poner la fecha de inicio: justo el dato que Compras necesita para
 * saber cuándo preparar los materiales.
 *
 * Sale solo al aprobar la cotización. Desde acá hay dos caminos: crear la obra
 * y nada más, o facturar un porcentaje del trabajo en el mismo movimiento —el
 * botón del medio abre el campo del porcentaje y el segundo clic ejecuta—, que
 * además del certificado deja la factura de avance en PDF.
 */
function ConvertQuoteModal({ quote, client, onClose, onDone }: { quote: Item; client?: Item; onClose: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [billing, setBilling] = useState(false);
  const [percentage, setPercentage] = useState("");
  const percentRef = useRef<HTMLInputElement>(null);
  // Qué botón disparó el envío: los dos son submit del mismo formulario.
  const action = useRef<"work" | "invoice">("work");
  // Si la obra ya se creó y falló lo de después, no se vuelve a convertir.
  const created = useRef<Item | null>(null);

  const budgetCents = Number(quote.amountCents || 0);
  // Se certifica sobre el neto: la factura le suma el IVA una sola vez.
  const netCents = typeof quote.netCents === "number" ? quote.netCents : netFromGross(budgetCents);
  const percent = Number(percentage) || 0;
  const invoiceCents = Math.round(netCents * percent / 100);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => { if (billing) percentRef.current?.focus(); }, [billing]);

  /** La factura de avance en PDF, con el logo del sitio incrustado. */
  async function downloadInvoice(work: Item, number: string, period: string, amountCents: number) {
    const [{ jsPDF }, logo, session] = await Promise.all([
      import("jspdf"),
      readPdfLogo(),
      fetch("/api/auth/me").then(response => response.ok ? response.json() : null).catch(() => null),
    ]);
    const doc = new jsPDF();
    const filename = buildInvoicePdf(doc, {
      company: quote.company === "constructora" ? "constructora" : "tvp",
      number, period, percentage: percent, amountCents,
      client: { name: String(client?.name || "—"), cuit: String(client?.cuit || ""), address: String(client?.address || ""), email: String(client?.email || "") },
      quote: { number: String(quote.number || ""), title: String(quote.title || ""), description: String(quote.description || ""), amountCents: netCents },
      work: { code: String(work.code || ""), name: String(work.name || ""), startDate: String(work.startDate || "") },
    }, { author: session?.name || "el sistema", logo });
    doc.save(filename);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invoicing = action.current === "invoice";
    if (invoicing && percent <= 0) return setError("Poné qué porcentaje de la obra vas a facturar");
    setSaving(true); setError("");
    const data = new FormData(event.currentTarget);

    let work = created.current;
    if (!work) {
      const response = await fetch(`/api/quotes/${quote._id}/convert`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: String(data.get("code") || ""), name: String(data.get("name") || ""), startDate: String(data.get("startDate") || "") || undefined }),
      });
      const result = await response.json();
      if (!response.ok) { setSaving(false); return setError(result.error || "No se pudo crear la obra"); }
      work = result as Item;
      created.current = work;
    }
    if (!invoicing) { setSaving(false); return onDone(); }

    // El avance se guarda como certificado aprobado: eso avisa a Administración
    // y le deja la tarea de emitir la factura de verdad.
    const number = `${String(work.code || "")}-C1`;
    const period = currentPeriod();
    const response = await fetch(`/api/works/${work._id}/certificates`, {
      method: "POST", headers: { "content-type": "application/json" },
      // El importe lo calcula el servidor sobre el presupuesto neto de la obra.
      body: JSON.stringify({ number, period, percentage: percent, approved: true, file: "" }),
    });
    const result = await response.json();
    const certificate = (result.certificates as Array<{ number?: string; amountCents?: number }> | undefined)?.find(item => item.number === number);
    if (!response.ok) { setSaving(false); return setError(`La obra ${String(work.code || "")} quedó creada, pero no se pudo facturar el avance: ${result.error || "error inesperado"}`); }
    try { await downloadInvoice(work, number, period, Number(certificate?.amountCents ?? invoiceCents)); }
    catch { setSaving(false); return setError(`Se facturó el ${percent}% de la obra ${String(work.code || "")}, pero no se pudo generar el PDF. Podés volver a emitirlo desde la obra.`); }
    setSaving(false);
    onDone();
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal convert-modal" role="dialog" aria-modal="true" aria-labelledby="convert-modal-title">
      <header><div className="modal-title-wrap"><span className="modal-heading-icon"><BriefcaseBusiness /></span><div>
        <p className="eyebrow">COTIZACIÓN APROBADA</p>
        <h2 id="convert-modal-title">Pasar {String(quote.number || "")} a obra</h2>
        <small>{String(quote.title || "")}{client ? ` · ${itemLabel(client)}` : ""}</small>
      </div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <form onSubmit={submit}>
        <div className="modal-form-body">
          <p className="convert-warning"><TriangleAlert size={17} /><span>Estás por convertir esta cotización en una obra. Va a salir del listado activo, no se va a poder volver a convertir y queda registrado que la pasaste vos. Compras recibe el aviso con la fecha de inicio.</span></p>
          <div className="form-grid">
            <label><span>Código de la obra *</span><input name="code" required defaultValue={`OB-${String(quote.number || "")}`} autoFocus /></label>
            <label><span>Nombre de la obra *</span><input name="name" required defaultValue={String(quote.title || "")} /></label>
            <label><span>Fecha de inicio</span><DateInput name="startDate" quickRanges={[7, 14, 30]} /></label>
            <label className="readonly-field"><span>Presupuesto que hereda</span><output>{money(budgetCents)} <small>({money(netCents)} sin IVA)</small></output></label>
          </div>

          {billing && <div className="convert-billing">
            <p className="eyebrow">FACTURAR AVANCE</p>
            <div className="form-grid">
              <label><span>¿Qué porcentaje facturás? *</span>
                <div className="percent-input">
                  {/* Sin `required`: con el campo abierto todavía se puede crear la obra sin facturar. */}
                  <input ref={percentRef} type="number" min="0.1" max="100" step="0.1" value={percentage}
                    onChange={event => setPercentage(event.target.value)} />
                  <Percent size={15} />
                </div>
                <div className="percent-quick">{[25, 50, 70, 100].map(value => <button key={value} type="button" className={percent === value ? "active" : ""} onClick={() => setPercentage(String(value))}>{value}%</button>)}</div>
              </label>
              <label className="readonly-field"><span>Importe neto a facturar</span><output>{money(invoiceCents)}</output></label>
            </div>
            <p className="invoice-note">
              {percent > 0
                ? <>Se certifica el <b>{percent}%</b> de {money(netCents)} netos = <b>{money(invoiceCents)}</b> más IVA. Se descarga la factura de avance en PDF (sin validez fiscal) y Administración recibe el aviso para emitir la factura real.</>
                : <>Elegí el porcentaje que vas a facturar y el importe se calcula solo.</>}
            </p>
          </div>}
        </div>
        {error && <p className="form-error modal-error">{error}</p>}
        <footer>
          <span>Queda auditado.</span>
          <button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button>
          <button type={billing ? "submit" : "button"} className="secondary-btn convert-invoice-btn" disabled={saving}
            onClick={() => { if (!billing) { setBilling(true); setError(""); return; } action.current = "invoice"; }}>
            <FileCheck2 size={16} /> {billing && percent > 0 ? `Facturar el ${percent}% y pasar a obra` : "Facturar y pasar a obra"}
          </button>
          <button className="primary-btn" disabled={saving} onClick={() => { action.current = "work"; }}>{saving ? "Creando la obra…" : "Sí, crear la obra"}</button>
        </footer>
      </form>
    </section>
  </div>;
}

type TrashRow = { _id: string; name: string; category: string; quantity: number; deletedAt: string; deletedByName: string };

const trashTexts = {
  stock: { eyebrow: "STOCK", noun: "Material", subtitle: "Materiales eliminados, con quién los borró y a qué hora", footer: "Restaurar devuelve el material al stock con sus cantidades." },
  works: { eyebrow: "OBRAS", noun: "Obra", subtitle: "Obras eliminadas, con quién las borró y a qué hora. No cuentan en los números.", footer: "Restaurar devuelve la obra con todo lo que tenía y vuelve a contar en los números." },
  clients: { eyebrow: "CLIENTES", noun: "Cliente", subtitle: "Clientes eliminados, con quién los borró y a qué hora. Ni ellos ni sus obras cuentan en los números.", footer: "Restaurar devuelve el cliente y vuelve a contar en los números." },
};

/** Papelera de stock, obras o clientes: qué se borró, quién y a qué hora, con la opción de devolverlo. */
function TrashModal({ entity, canRestore, onClose, onRestored }: { entity: "stock" | "works" | "clients"; canRestore: boolean; onClose: () => void; onRestored: () => void }) {
  const texts = trashTexts[entity];
  const [rows, setRows] = useState<TrashRow[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [canPurge, setCanPurge] = useState(false);

  useEffect(() => {
    void fetch(`/api/trash?entity=${entity}`).then(response => response.json()).then(result => { setRows(result.items || []); setCanPurge(Boolean(result.canPurge)); }).catch(() => { setRows([]); setError("No se pudo leer la papelera"); });
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [entity, onClose]);

  async function restore(row: TrashRow) {
    setBusy(row._id); setError("");
    const response = await fetch(`/api/trash/${row._id}`, { method: "POST" });
    if (response.ok) { setRows(current => (current || []).filter(candidate => candidate._id !== row._id)); onRestored(); }
    else setError((await response.json()).error || "No se pudo restaurar");
    setBusy("");
  }

  async function purge(row: TrashRow) {
    if (!confirm(`¿Eliminar "${row.name || texts.noun.toLowerCase()}" para siempre? No se va a poder restaurar y lo que generó sigue sin contar en los números.`)) return;
    setBusy(row._id); setError("");
    const response = await fetch(`/api/trash/${row._id}`, { method: "DELETE" });
    if (response.ok) setRows(current => (current || []).filter(candidate => candidate._id !== row._id));
    else setError((await response.json()).error || "No se pudo eliminar");
    setBusy("");
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" />
    <section className="modal history-modal" role="dialog" aria-modal="true" aria-labelledby="trash-modal-title">
      <header>
        <div className="modal-title-wrap"><span className="modal-heading-icon"><Trash2 /></span><div>
          <p className="eyebrow">{texts.eyebrow}</p>
          <h2 id="trash-modal-title">Papelera</h2>
          <small>{texts.subtitle}</small>
        </div></div>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button>
      </header>
      <div className="modal-form-body">
        {error && <p className="form-error">{error}</p>}
        {rows === null ? <div className="loading-state">Cargando…</div> : !rows.length ? <div className="empty-state compact"><p>La papelera está vacía.</p></div>
          : <div className="table-scroll"><table><thead><tr><th>{texts.noun}</th>{entity === "stock" && <><th>Rubro</th><th>Cantidad</th></>}<th>Eliminado por</th><th>Fecha y hora</th><th /></tr></thead><tbody>{rows.map(row => <tr key={row._id}>
            <td data-label={texts.noun}>{row.name || "—"}</td>
            {entity === "stock" && <><td data-label="Rubro">{row.category || "—"}</td>
            <td data-label="Cantidad">{row.quantity ? qty(row.quantity) : "—"}</td></>}
            <td data-label="Eliminado por">{row.deletedByName || "—"}</td>
            <td data-label="Fecha y hora">{dateTime(row.deletedAt)} hs</td>
            <td className="row-actions">{canRestore && <button className="row-action-wide approve" disabled={busy === row._id} onClick={() => { void restore(row); }}><History size={15} /> Restaurar</button>}
              {canPurge && <button title="Eliminar para siempre" aria-label={`Eliminar ${row.name || texts.noun.toLowerCase()} para siempre`} disabled={busy === row._id} onClick={() => { void purge(row); }}><Trash2 size={16} /></button>}</td>
          </tr>)}</tbody></table></div>}
      </div>
      <footer><span>{texts.footer}</span><button type="button" className="secondary-btn" onClick={onClose}>Cerrar</button></footer>
    </section>
  </div>;
}

const workGroups = [
  { title: "Identificación", description: "Datos principales de la obra", keys: ["code", "name", "clientId", "quoteId"] },
  { title: "Planificación", description: "Fechas y estado", keys: ["startDate", "endDate", "status"] },
  { title: "Control económico", description: "Presupuesto y centro de costo", keys: ["budgetCents", "costCenter"] },
];

function WorkFields({ fields, fieldProps }: { fields: Field[]; fieldProps: (field: Field) => FieldProps }) {
  return <div className="work-form-sections">{workGroups.map((group, groupIndex) => <fieldset key={group.title}><legend><b>{group.title}</b><small>{group.description}</small></legend><div className="form-grid">{group.keys.map((key, index) => {
    const field = fields.find(candidate => candidate.key === key);
    return field ? <FormField key={field.key} {...fieldProps(field)} autoFocus={groupIndex === 0 && index === 0} /> : null;
  })}</div></fieldset>)}</div>;
}

function TaskModal({ task, config, fieldProps, error, saving, onClose, onSubmit }: { task: Item | null; config: typeof entityConfig["tasks"]; fieldProps: (field: Field) => FieldProps; error: string; saving: boolean; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const status = String(task?.status || "pendiente");
  return <div className="modal-layer"><button className="modal-backdrop" onClick={onClose} aria-label="Cerrar" /><section className="modal entity-modal task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title">
    <header><div className="modal-title-wrap"><span className="modal-heading-icon"><ListTodo /></span><div><p className="eyebrow">{task ? "DETALLE DE TAREA" : "NUEVA TAREA"}</p><h2 id="task-modal-title">{task ? String(task.title || "Tarea") : "Nueva tarea"}</h2><small>Seguimiento operativo con trazabilidad de cada modificación</small></div></div><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><X /></button></header>
    {task && <div className="task-summary"><div className="task-summary-icon"><ListTodo size={21} /></div><div><span>Estado actual</span><strong className={`badge ${status}`}>{titleCase(status)}</strong></div><div><span>Vencimiento</span><strong><CalendarDays size={14} />{date(task.dueDate as string)}</strong></div><div><span>Responsable</span><strong><UserRound size={14} />{task.assigneeRole ? titleCase(String(task.assigneeRole)) : "Sin asignar"}</strong></div></div>}
    <form onSubmit={onSubmit}><div className="modal-form-body"><div className="task-form-heading"><div><p className="eyebrow">INFORMACIÓN</p><h3>Datos de la tarea</h3></div><span>Los cambios quedan registrados automáticamente.</span></div><div className="form-grid">{config.fields.map((field, index) => <FormField key={field.key} {...fieldProps(field)} value={task?.[field.key]} autoFocus={index === 0} />)}</div></div>{error && <p className="form-error modal-error">{error}</p>}<footer><span>Usuario, fecha y hora se guardan en cada cambio.</span><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button></footer></form>
    {task && <div className="modal-form-body"><RecordHistory entity="tasks" recordId={task._id} embedded /></div>}
  </section></div>;
}
