# Esquema de la base de datos

> ⚠️ **Documento generado.** No lo edites a mano: se sobrescribe.
> Se produce leyendo los modelos reales de `src/lib/models.ts`, así que refleja
> exactamente lo que la base guarda hoy.
>
> Regenerar con:
>
> ```bash
> pnpm docs:schema
> ```

Generado el 2026-09-25 · 20 colecciones.

Para el modelo de negocio *deseado* — lo que el cliente pidió y todavía no existe —
ver [[cotizador-cascada]], [[liquidacion-quincenal]] y [[certificado-obra]].

---

## Módulos del sistema

### Clientes

Colección `clients` · entidad `clients`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `name` | texto | sí | — |
| `cuit` | texto | — | — |
| `contactName` | texto | — | — |
| `email` | texto | — | — |
| `phones` | lista | — | por defecto `[]` |
| `address` | texto | — | — |
| `notes` | texto | — | — |
| `active` | sí/no | — | por defecto `true` |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Cotizaciones

Colección `quotes` · entidad `quotes`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `number` | texto | sí | único |
| `clientId` | referencia | sí | apunta a **Client** |
| `title` | texto | sí | — |
| `description` | texto | — | — |
| `version` | número | — | mínimo 1 · por defecto `1` |
| `amountCents` | número | — | mínimo 0 · por defecto `0` |
| `estimatedCostCents` | número | — | mínimo 0 · por defecto `0` |
| `status` | texto | — | valores: `borrador` · `enviada` · `seguimiento` · `aprobada` · `rechazada` · `vencida` · `convertida` · por defecto `"borrador"` |
| `ownerId` | referencia | — | apunta a **User** |
| `validUntil` | fecha | — | — |
| `workId` | referencia | — | apunta a **Work** |
| `attachment` | texto | — | — |
| `items` | lista de objetos | — | por defecto `[]` |
| `items.code` | texto | — | — |
| `items.name` | texto | sí | — |
| `items.unit` | texto | — | por defecto `"m2"` |
| `items.qty` | número | — | por defecto `0` |
| `items.detail` | texto | — | — |
| `items.composition` | lista de objetos | — | por defecto `[]` |
| `items.composition.rubro` | texto | — | valores: `MAT` · `MO` · `EQUIPOS` · por defecto `"MAT"` |
| `items.composition.code` | texto | — | — |
| `items.composition.name` | texto | sí | — |
| `items.composition.unit` | texto | — | por defecto `"u"` |
| `items.composition.coefPerUnit` | número | — | por defecto `0` |
| `items.composition.unitPriceCents` | número | — | mínimo 0 · por defecto `0` |
| `items.composition.currency` | texto | — | valores: `ARS` · `USD` · por defecto `"ARS"` |
| `items.composition.fxRate` | número | — | por defecto `0` |
| `items.composition.stockItemId` | referencia | — | apunta a **StockItem** |
| `items.composition.workerId` | referencia | — | apunta a **Worker** |
| `items.composition.personas` | número | — | por defecto `0` |
| `overheads` | lista de objetos | — | por defecto `[]` |
| `overheads.conceptKey` | texto | sí | — |
| `overheads.group` | texto | — | — |
| `overheads.label` | texto | — | — |
| `overheads.unit` | texto | — | — |
| `overheads.qty` | número | — | por defecto `0` |
| `overheads.unitPriceCents` | número | — | mínimo 0 · por defecto `0` |
| `overheads.formula` | texto | — | valores: `impuesto_cheque` · `representacion_tecnica` · `mes_hombre` |
| `overheads.formulaPct` | número | — | — |
| `overheads.personas` | número | — | — |
| `overheads.dias` | número | — | — |
| `cascade` | objeto | — | — |
| `cascade.ggiPct` | número | — | por defecto `18` |
| `cascade.benefitPct` | número | — | por defecto `30` |
| `cascade.financialPct` | número | — | por defecto `0` |
| `cascade.iibbPct` | número | — | por defecto `2.5` |
| `cascade.ivaPct` | número | — | por defecto `21` |
| `cascade.ivaBase` | texto | — | valores: `st2` · `st3` · por defecto `"st2"` |
| `cascade.chequePct` | número | — | por defecto `0` |
| `history` | lista de objetos | — | — |
| `history.action` | texto | — | — |
| `history.note` | texto | — | — |
| `history.at` | fecha | — | — |
| `history.userId` | referencia | — | — |
| `history.userName` | texto | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Obras

Colección `works` · entidad `works`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `code` | texto | sí | único |
| `name` | texto | sí | — |
| `clientId` | referencia | sí | apunta a **Client** |
| `quoteId` | referencia | — | apunta a **Quote** |
| `managerId` | referencia | — | apunta a **User** |
| `status` | texto | — | valores: `planificada` · `en_curso` · `pausada` · `terminada` · `cancelada` · por defecto `"planificada"` |
| `startDate` | fecha | — | — |
| `endDate` | fecha | — | — |
| `budgetCents` | número | — | mínimo 0 · por defecto `0` |
| `progress` | número | — | mínimo 0 · máximo 100 · por defecto `0` |
| `progressMode` | texto | — | valores: `inspecciones` · `manual` · `sin_base` · por defecto `"sin_base"` |
| `progressUpdatedAt` | fecha | — | — |
| `progressBase` | lista de objetos | — | — |
| `progressBase.rubro` | texto | sí | valores: `albanileria` · `impermeabilizacion` · `espuma_poliuretano` · `pintura` · `trabajos_altura` |
| `progressBase.label` | texto | sí | — |
| `progressBase.unit` | texto | — | por defecto `"m2"` |
| `progressBase.plannedQty` | número | — | mínimo 0 · por defecto `0` |
| `progressBase.initialQty` | número | — | mínimo 0 · por defecto `0` |
| `progressBase.amountCents` | número | — | mínimo 0 · por defecto `0` |
| `costCenter` | texto | — | — |
| `checklist` | lista de objetos | — | — |
| `checklist.title` | texto | sí | — |
| `checklist.done` | sí/no | — | por defecto `false` |
| `checklist.completedAt` | fecha | — | — |
| `checklist.createdAt` | fecha | — | — |
| `checklist.updatedAt` | fecha | — | — |
| `activity` | lista de objetos | — | — |
| `activity.detail` | texto | sí | — |
| `activity.photos` | lista | — | — |
| `activity.userId` | referencia | sí | apunta a **User** |
| `activity.authorName` | texto | sí | — |
| `activity.createdAt` | fecha | — | — |
| `advances` | lista de objetos | — | — |
| `advances.percentage` | número | — | — |
| `advances.note` | texto | — | — |
| `advances.date` | fecha | — | — |
| `advances.userId` | referencia | — | — |
| `advances.photos` | lista | — | — |
| `certificates` | lista de objetos | — | — |
| `certificates.number` | texto | — | — |
| `certificates.period` | texto | — | — |
| `certificates.percentage` | número | — | — |
| `certificates.amountCents` | número | — | — |
| `certificates.expensesCents` | número | — | mínimo 0 · por defecto `0` |
| `certificates.includeExpenses` | sí/no | — | por defecto `false` |
| `certificates.approved` | sí/no | — | — |
| `certificates.invoiced` | sí/no | — | — |
| `certificates.file` | texto | — | — |
| `certificates.files` | lista de objetos | — | — |
| `certificates.files.path` | texto | sí | — |
| `certificates.files.name` | texto | — | — |
| `certificates.files.uploadedAt` | fecha | — | — |
| `certificates.files.uploadedByName` | texto | — | — |
| `assignedWorkers` | lista de objetos | — | — |
| `assignedWorkers.workerId` | referencia | — | apunta a **Worker** |
| `assignedWorkers.name` | texto | — | — |
| `assignedWorkers.dni` | texto | — | — |
| `assignedWorkers.phone` | texto | — | — |
| `assignedWorkers.category` | texto | — | — |
| `assignedWorkers.rateMode` | texto | — | valores: `jornada` · `hora` · por defecto `"jornada"` |
| `assignedWorkers.dailyRateCents` | número | — | — |
| `assignedWorkers.hoursPerDay` | número | — | — |
| `assignedWorkers.hourlyRateCents` | número | — | — |
| `assignedWorkers.assignedAt` | fecha | — | — |
| `assignedWorkers.assignedByName` | texto | — | — |
| `labor` | lista de objetos | — | — |
| `labor.workerId` | referencia | — | apunta a **Worker** |
| `labor.person` | texto | — | — |
| `labor.date` | fecha | — | — |
| `labor.mode` | texto | — | valores: `jornada` · `hora` · por defecto `"hora"` |
| `labor.hours` | número | — | — |
| `labor.days` | número | — | — |
| `labor.dailyRateCents` | número | — | — |
| `labor.hourlyRateCents` | número | — | — |
| `labor.costCents` | número | — | — |
| `labor.manualCost` | sí/no | — | por defecto `false` |
| `labor.note` | texto | — | — |
| `labor.loadedByName` | texto | — | — |
| `labor.createdAt` | fecha | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Personal asignado

Colección `workers` · entidad `workers`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `name` | texto | — | — |
| `firstName` | texto | sí | — |
| `lastName` | texto | sí | — |
| `dni` | texto | sí | — |
| `phone` | texto | — | — |
| `category` | texto | — | valores: `capataz` · `oficial` · `medio_oficial` · `ayudante` · `especialista` · por defecto `"oficial"` |
| `rateMode` | texto | — | valores: `jornada` · `hora` · por defecto `"jornada"` |
| `dailyRateCents` | número | — | mínimo 0 · por defecto `0` |
| `hoursPerDay` | número | — | mínimo 1 · máximo 24 · por defecto `8` |
| `hourlyRateCents` | número | — | mínimo 0 · por defecto `0` |
| `active` | sí/no | — | por defecto `true` |
| `notes` | texto | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Proveedores

Colección `suppliers` · entidad `suppliers`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `name` | texto | sí | — |
| `contactName` | texto | — | — |
| `email` | texto | — | — |
| `phone` | texto | — | — |
| `address` | texto | — | — |
| `notes` | texto | — | — |
| `active` | sí/no | — | por defecto `true` |
| `discountPct` | número | — | mínimo 0 · máximo 100 · por defecto `0` |
| `priceFormat` | libre | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Stock

Colección `stockitems` · entidad `stock`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `name` | texto | sí | — |
| `sku` | texto | — | — |
| `category` | texto | — | valores: `materiales` · `herramientas` · `seguridad` · `consumibles` · `otros` · por defecto `"materiales"` |
| `unit` | texto | — | valores: `unidad` · `kg` · `litro` · `metro` · `m2` · `m3` · `bolsa` · `balde` · `rollo` · por defecto `"unidad"` |
| `quantity` | número | — | por defecto `0` |
| `minQuantity` | número | — | mínimo 0 · por defecto `0` |
| `qty_central` | número | — | — |
| `min_central` | número | — | mínimo 0 |
| `qty_salon` | número | — | — |
| `min_salon` | número | — | mínimo 0 |
| `avgCostCents` | número | — | mínimo 0 · por defecto `0` |
| `valueCents` | número | — | mínimo 0 · por defecto `0` |
| `supplierId` | referencia | — | apunta a **Supplier** |
| `location` | texto | — | — |
| `notes` | texto | — | — |
| `active` | sí/no | — | por defecto `true` |
| `movements` | lista de objetos | — | — |
| `movements.kind` | texto | sí | valores: `ingreso` · `egreso` · `transferencia` · `ajuste` |
| `movements.quantity` | número | sí | — |
| `movements.warehouse` | texto | — | valores: `central` · `salon` |
| `movements.toWarehouse` | texto | — | valores: `central` · `salon` |
| `movements.remito` | texto | — | — |
| `movements.destinationLabel` | texto | — | — |
| `movements.quoteNumber` | texto | — | — |
| `movements.unitCostCents` | número | — | mínimo 0 · por defecto `0` |
| `movements.totalCents` | número | — | mínimo 0 · por defecto `0` |
| `movements.supplierId` | referencia | — | apunta a **Supplier** |
| `movements.workId` | referencia | — | apunta a **Work** |
| `movements.reference` | texto | — | — |
| `movements.note` | texto | — | — |
| `movements.date` | fecha | — | — |
| `movements.userId` | referencia | — | apunta a **User** |
| `movements.userName` | texto | — | — |
| `movements.purchaseId` | referencia | — | apunta a **Purchase** |
| `movements.expenseId` | referencia | — | apunta a **Expense** |
| `movements.createdAt` | fecha | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Órdenes de compra

Colección `purchases` · entidad `purchases`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `number` | texto | sí | único |
| `supplierId` | referencia | — | apunta a **Supplier** |
| `workId` | referencia | — | apunta a **Work** |
| `description` | texto | sí | — |
| `amountCents` | número | — | mínimo 0 · por defecto `0` |
| `stage` | texto | — | valores: `solicitud` · `orden` · `recepcion` · por defecto `"solicitud"` |
| `status` | texto | — | valores: `borrador` · `aprobada` · `enviada` · `recibida` · `cancelada` · por defecto `"borrador"` |
| `requestedDate` | fecha | sí | — |
| `expectedDate` | fecha | — | — |
| `receivedDate` | fecha | — | — |
| `receiptNotes` | texto | — | — |
| `items` | lista de objetos | — | — |
| `items.priceListItemId` | referencia | — | apunta a **PriceListItem** |
| `items.code` | texto | — | — |
| `items.name` | texto | sí | — |
| `items.presentation` | texto | — | — |
| `items.minSale` | texto | — | — |
| `items.quantity` | número | sí | mínimo 0 |
| `items.listPriceCents` | número | — | mínimo 0 · por defecto `0` |
| `items.discountPct` | número | — | por defecto `0` |
| `items.unitCents` | número | — | mínimo 0 · por defecto `0` |
| `items.totalCents` | número | — | mínimo 0 · por defecto `0` |
| `subtotalCents` | número | — | — |
| `vatCents` | número | — | — |
| `notes` | texto | — | — |
| `priceListId` | referencia | — | apunta a **PriceList** |
| `priceListDate` | fecha | — | — |
| `userId` | referencia | — | apunta a **User** |
| `userName` | texto | — | — |
| `deliverTo` | texto | — | valores: `central` · `salon` · `obra` · por defecto `"central"` |
| `quoteNumber` | texto | — | — |
| `stockedAt` | fecha | — | — |
| `stockedWarehouse` | texto | — | valores: `central` · `salon` |
| `stockedByName` | texto | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Compras y gastos

Colección `expenses` · entidad `expenses`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `number` | texto | — | — |
| `supplierId` | referencia | — | apunta a **Supplier** |
| `workId` | referencia | — | apunta a **Work** |
| `description` | texto | sí | — |
| `category` | texto | sí | valores: `materiales` · `transporte` · `combustible` · `servicios` · `costo_indirecto` · `gasto_fijo` · `mano_obra` |
| `amountCents` | número | — | mínimo 0 · por defecto `0` |
| `issueDate` | fecha | sí | — |
| `dueDate` | fecha | — | — |
| `status` | texto | — | valores: `pendiente` · `parcial` · `pagado` · `anulado` · por defecto `"pendiente"` |
| `paidCents` | número | — | mínimo 0 · por defecto `0` |
| `attachment` | texto | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Facturación

Colección `invoices` · entidad `invoices`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `number` | texto | sí | — |
| `clientId` | referencia | sí | apunta a **Client** |
| `workId` | referencia | — | apunta a **Work** |
| `certificateNumber` | texto | — | — |
| `description` | texto | — | — |
| `issueDate` | fecha | sí | — |
| `dueDate` | fecha | — | — |
| `amountCents` | número | — | mínimo 0 · por defecto `0` |
| `collectedCents` | número | — | mínimo 0 · por defecto `0` |
| `status` | texto | — | valores: `pendiente` · `parcial` · `cobrada` · `anulada` · por defecto `"pendiente"` |
| `attachment` | texto | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Cobranzas

Colección `collections` · entidad `collections`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `clientId` | referencia | sí | apunta a **Client** |
| `invoiceId` | referencia | — | apunta a **Invoice** |
| `date` | fecha | sí | — |
| `amountCents` | número | — | mínimo 0 · por defecto `0` |
| `method` | texto | sí | valores: `transferencia` · `efectivo` · `cheque` · `retencion` · `otro` |
| `account` | texto | — | — |
| `reference` | texto | — | — |
| `notes` | texto | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Pagos

Colección `payments` · entidad `payments`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `supplierId` | referencia | — | apunta a **Supplier** |
| `expenseId` | referencia | — | apunta a **Expense** |
| `date` | fecha | sí | — |
| `amountCents` | número | — | mínimo 0 · por defecto `0` |
| `method` | texto | sí | valores: `transferencia` · `efectivo` · `cheque` · `otro` |
| `account` | texto | — | — |
| `reference` | texto | — | — |
| `notes` | texto | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Cheques

Colección `checks` · entidad `checks`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `direction` | texto | sí | valores: `recibido` · `emitido` |
| `bank` | texto | sí | — |
| `number` | texto | sí | — |
| `issuer` | texto | — | — |
| `amountCents` | número | — | mínimo 0 · por defecto `0` |
| `dueDate` | fecha | sí | — |
| `status` | texto | — | valores: `cartera` · `depositado` · `cobrado` · `endosado` · `rechazado` · `emitido` · por defecto `"cartera"` |
| `clientId` | referencia | — | apunta a **Client** |
| `supplierId` | referencia | — | apunta a **Supplier** |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Caja y bancos

Colección `cashmovements` · entidad `cash`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `date` | fecha | sí | — |
| `direction` | texto | sí | valores: `ingreso` · `egreso` |
| `account` | texto | sí | — |
| `category` | texto | sí | — |
| `description` | texto | sí | — |
| `amountCents` | número | — | mínimo 0 · por defecto `0` |
| `reference` | texto | — | — |
| `reconciled` | sí/no | — | por defecto `false` |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Tareas y pendientes

Colección `tasks` · entidad `tasks`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `title` | texto | sí | — |
| `description` | texto | — | — |
| `type` | texto | — | valores: `general` · `facturar_certificado` · `cobranza` · `vencimiento` · por defecto `"general"` |
| `status` | texto | — | valores: `pendiente` · `en_curso` · `completada` · por defecto `"pendiente"` |
| `dueDate` | fecha | — | — |
| `assigneeRole` | texto | — | valores: `gerencia` · `arquitecto` · `auxiliar` · `administracion` · `compras` · `ventas` · `contador` |
| `assigneeId` | referencia | — | apunta a **User** |
| `assigneeName` | texto | — | — |
| `relatedType` | texto | — | — |
| `relatedId` | referencia | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

---

## Colecciones internas

### User

Usuarios del sistema y sus permisos. Colección `users`.

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `name` | texto | sí | — |
| `email` | texto | sí | único |
| `passwordHash` | texto | — | — |
| `role` | texto | sí | valores: `gerencia` · `arquitecto` · `auxiliar` · `administracion` · `compras` · `ventas` · `contador` |
| `active` | sí/no | — | por defecto `true` |
| `inviteTokenHash` | texto | — | — |
| `inviteExpiresAt` | fecha | — | — |
| `inviteKind` | texto | — | valores: `invite` · `reset` |
| `invitedAt` | fecha | — | — |
| `passwordSetAt` | fecha | — | — |
| `permissions` | objeto | — | — |
| `permissions.view` | lista | — | — |
| `permissions.edit` | lista | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### AuditLog

Registro de auditoría: quién cambió qué y cuándo. Colección `auditlogs`.

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `userId` | referencia | — | apunta a **User** |
| `userName` | texto | — | — |
| `userEmail` | texto | — | — |
| `action` | texto | sí | — |
| `entity` | texto | sí | — |
| `entityId` | referencia | — | — |
| `before` | libre | — | — |
| `after` | libre | — | — |
| `ip` | texto | — | — |
| `createdAt` | fecha | — | — |

### Counter

Contadores para numeración correlativa (hoy: cotizaciones). Colección `counters`.

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `seq` | número | — | por defecto `0` |

### WorkInspection

Inspecciones diarias de obra, una por obra, rubro y día. De acá sale el avance físico. Colección `workinspections`.

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `workId` | referencia | sí | apunta a **Work** |
| `date` | fecha | sí | — |
| `dayKey` | texto | sí | — |
| `rubro` | texto | sí | valores: `albanileria` · `impermeabilizacion` · `espuma_poliuretano` · `pintura` · `trabajos_altura` |
| `templateVersion` | número | — | por defecto `1` |
| `status` | texto | — | valores: `borrador` · `cerrada` · por defecto `"borrador"` |
| `managerName` | texto | — | — |
| `weather` | texto | — | valores: `seco` · `humedo` · `lluvia` · `viento` · `` · por defecto `""` |
| `qualityResponsibleName` | texto | — | — |
| `staff.source` | texto | — | valores: `partes` · `manual` · por defecto `"partes"` |
| `staff.oficiales` | número | — | mínimo 0 · por defecto `0` |
| `staff.medioOficiales` | número | — | mínimo 0 · por defecto `0` |
| `staff.ayudantes` | número | — | mínimo 0 · por defecto `0` |
| `staff.otros` | número | — | mínimo 0 · por defecto `0` |
| `staff.hoursWorked` | número | — | mínimo 0 · por defecto `0` |
| `staff.checkIn` | texto | — | — |
| `staff.checkOut` | texto | — | — |
| `staff.people` | lista de objetos | — | — |
| `staff.people.name` | texto | — | — |
| `staff.people.category` | texto | — | — |
| `staff.people.hours` | número | — | — |
| `production` | lista de objetos | — | — |
| `production.lineId` | referencia | — | — |
| `production.label` | texto | — | — |
| `production.unit` | texto | — | — |
| `production.plannedQty` | número | — | por defecto `0` |
| `production.previousQty` | número | — | por defecto `0` |
| `production.todayQty` | número | — | mínimo 0 |
| `production.accumulatedQty` | número | — | por defecto `0` |
| `production.progressPct` | número | — | — |
| `rubroProgressPct` | número | — | — |
| `workProgressPct` | número | — | — |
| `stage` | texto | — | — |
| `performance` | texto | — | valores: `bueno` · `normal` · `bajo` · `` · por defecto `""` |
| `lowPerformanceReason` | texto | — | — |
| `productionConsumption` | texto | — | valores: `acorde` · `consumo_alto` · `produccion_baja` · `` · por defecto `""` |
| `quality` | lista de objetos | — | — |
| `quality.key` | texto | — | — |
| `quality.label` | texto | — | — |
| `quality.result` | texto | — | valores: `cumple` · `no_cumple` · `na` · `` · por defecto `""` |
| `quality.notes` | texto | — | — |
| `qualityNotes` | texto | — | — |
| `materialsReceived` | lista de objetos | — | — |
| `materialsReceived.source` | texto | — | valores: `stock` · `manual` · por defecto `"manual"` |
| `materialsReceived.stockItemId` | referencia | — | — |
| `materialsReceived.movementId` | referencia | — | — |
| `materialsReceived.name` | texto | — | — |
| `materialsReceived.unit` | texto | — | — |
| `materialsReceived.quantity` | número | — | mínimo 0 · por defecto `0` |
| `materialsReceived.condition` | texto | — | valores: `ok` · `danado` · `` · por defecto `"ok"` |
| `materialsReceived.notes` | texto | — | — |
| `mainMaterial.stockItemId` | referencia | — | — |
| `mainMaterial.name` | texto | — | — |
| `mainMaterial.unit` | texto | — | — |
| `mainMaterial.plannedQty` | número | — | — |
| `mainMaterial.stockStart` | número | — | — |
| `mainMaterial.receivedToday` | número | — | — |
| `mainMaterial.stockEnd` | número | — | — |
| `mainMaterial.receivedPrevious` | número | — | — |
| `mainMaterial.receivedAccumulated` | número | — | — |
| `mainMaterial.consumptionToday` | número | — | — |
| `mainMaterial.previousConsumption` | número | — | — |
| `mainMaterial.consumptionAccumulated` | número | — | — |
| `mainMaterial.remaining` | número | — | — |
| `mainMaterial.consumptionPct` | número | — | — |
| `mainMaterial.enough` | sí/no | — | — |
| `mainMaterial.deviation` | texto | — | valores: `acorde` · `consumo_alto` · `consumo_bajo` |
| `mainMaterial.notes` | texto | — | — |
| `shortages` | lista de objetos | — | — |
| `shortages.material` | texto | — | — |
| `shortages.quantity` | número | — | — |
| `shortages.unit` | texto | — | — |
| `shortageNeededBy` | fecha | — | — |
| `shortageOrderStatus` | texto | — | valores: `pedido_realizado` · `pedido_pendiente` · `` · por defecto `""` |
| `safety` | lista de objetos | — | — |
| `safety.key` | texto | — | — |
| `safety.label` | texto | — | — |
| `safety.result` | texto | — | valores: `cumple` · `no_cumple` · `na` · `` · por defecto `""` |
| `safety.notes` | texto | — | — |
| `incidents` | texto | — | — |
| `colors` | lista de objetos | — | — |
| `colors.sector` | texto | — | — |
| `colors.color` | texto | — | — |
| `colors.paintType` | texto | — | — |
| `colors.brand` | texto | — | — |
| `colors.notes` | texto | — | — |
| `photos` | lista | — | — |
| `notes` | texto | — | — |
| `alerts` | lista de objetos | — | — |
| `alerts.kind` | texto | — | — |
| `alerts.message` | texto | — | — |
| `createdById` | referencia | — | apunta a **User** |
| `createdByName` | texto | — | — |
| `closedAt` | fecha | — | — |
| `closedById` | referencia | — | apunta a **User** |
| `closedByName` | texto | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### PriceList

Listas de precios de proveedores: el Excel que mandó cada uno y desde cuándo vale. La vigente es una por proveedor; las anteriores quedan como historia. Colección `pricelists`.

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `supplierId` | referencia | sí | apunta a **Supplier** |
| `validFrom` | fecha | sí | — |
| `fileName` | texto | — | — |
| `file` | texto | — | — |
| `sheet` | texto | — | — |
| `pricesIncludeVat` | sí/no | — | por defecto `false` |
| `current` | sí/no | — | por defecto `false` |
| `itemCount` | número | — | por defecto `0` |
| `summary.added` | número | — | — |
| `summary.up` | número | — | — |
| `summary.down` | número | — | — |
| `summary.same` | número | — | — |
| `summary.removed` | número | — | — |
| `legend` | libre | — | — |
| `userId` | referencia | — | apunta a **User** |
| `userName` | texto | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### PriceListItem

Cada producto de una lista de precios, sin IVA. El buscador de precios recorre los de las listas vigentes. Colección `pricelistitems`.

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `supplierId` | referencia | sí | apunta a **Supplier** |
| `priceListId` | referencia | sí | apunta a **PriceList** |
| `current` | sí/no | — | por defecto `false` |
| `row` | número | — | — |
| `code` | texto | — | — |
| `name` | texto | sí | — |
| `description` | texto | — | — |
| `presentation` | texto | — | — |
| `minSale` | texto | — | — |
| `category` | texto | — | — |
| `subcategory` | texto | — | — |
| `kind` | texto | — | — |
| `listPriceCents` | número | — | mínimo 0 · por defecto `0` |
| `previousPriceCents` | número | — | — |
| `measureQty` | número | — | — |
| `measureUnit` | texto | — | — |
| `searchText` | texto | — | — |
