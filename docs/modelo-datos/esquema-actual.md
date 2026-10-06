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

Generado el 2026-10-06 · 26 colecciones.

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
| `vatCondition` | texto | — | valores: `responsable_inscripto` · `monotributo` · `exento` · `consumidor_final` · `no_alcanzado` |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Cotizaciones

Colección `quotes` · entidad `quotes`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `number` | texto | sí | único |
| `company` | texto | — | valores: `tvp` · `constructora` · por defecto `"tvp"` |
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
| `status` | texto | — | valores: `planificada` · `en_curso` · `pausada` · `terminada` · `cerrada` · `cancelada` · por defecto `"planificada"` |
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
| `labor.workTypeId` | referencia | — | apunta a **WorkType** |
| `labor.workType` | texto | — | — |
| `labor.unit` | texto | — | — |
| `labor.importKey` | texto | — | — |
| `labor.note` | texto | — | — |
| `labor.loadedByName` | texto | — | — |
| `labor.createdAt` | fecha | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Personal

Colección `workers` · entidad `workers`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `name` | texto | — | — |
| `firstName` | texto | sí | — |
| `lastName` | texto | sí | — |
| `fileNumber` | número | — | — |
| `activeSince` | fecha | — | — |
| `leftAt` | fecha | — | — |
| `leaveReason` | texto | — | — |
| `fileHistory` | lista de objetos | — | — |
| `fileHistory.fileNumber` | número | — | — |
| `fileHistory.from` | fecha | — | — |
| `fileHistory.to` | fecha | — | — |
| `fileHistory.reason` | texto | — | — |
| `position` | texto | — | — |
| `workType` | texto | — | — |
| `dni` | texto | — | — |
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
| `cuit` | texto | — | — |
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
| `barcode` | texto | — | — |
| `category` | texto | — | valores: `materiales` · `herramientas` · `seguridad` · `consumibles` · `otros` · por defecto `"materiales"` |
| `unit` | texto | — | valores: `unidad` · `kg` · `litro` · `metro` · `m2` · `m3` · `bolsa` · `balde` · `rollo` · por defecto `"unidad"` |
| `quantity` | número | — | por defecto `0` |
| `minQuantity` | número | — | mínimo 0 · por defecto `0` |
| `qty_central` | número | — | — |
| `min_central` | número | — | mínimo 0 |
| `qty_salon` | número | — | — |
| `min_salon` | número | — | mínimo 0 |
| `owners` | libre | — | — |
| `transitQty` | número | — | mínimo 0 · por defecto `0` |
| `unusableQty` | número | — | mínimo 0 · por defecto `0` |
| `reservedQty` | número | — | mínimo 0 · por defecto `0` |
| `avgCostCents` | número | — | mínimo 0 · por defecto `0` |
| `valueCents` | número | — | mínimo 0 · por defecto `0` |
| `supplierId` | referencia | — | apunta a **Supplier** |
| `location` | texto | — | — |
| `notes` | texto | — | — |
| `active` | sí/no | — | por defecto `true` |
| `movements` | lista de objetos | — | — |
| `movements.kind` | texto | sí | valores: `ingreso` · `egreso` · `transferencia` · `recepcion` · `ajuste` · `venta` · `devolucion` · `no_utilizable` |
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
| `movements.ticket` | texto | — | — |
| `movements.owner` | texto | — | valores: `tvp` · `constructora` · `sin_asignar` |
| `movements.ownerParts` | lista de objetos | — | — |
| `movements.ownerParts.owner` | texto | — | valores: `tvp` · `constructora` · `sin_asignar` |
| `movements.ownerParts.quantity` | número | — | — |
| `movements.transferId` | referencia | — | apunta a **StockTransfer** |
| `movements.salesRemitoId` | referencia | — | apunta a **SalesRemito** |
| `movements.clientId` | referencia | — | apunta a **Client** |
| `movements.createdAt` | fecha | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Solicitudes y órdenes de compra

Colección `purchases` · entidad `purchases`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `number` | texto | sí | único |
| `company` | texto | — | valores: `tvp` · `constructora` · por defecto `"tvp"` |
| `supplierId` | referencia | — | apunta a **Supplier** |
| `workId` | referencia | — | apunta a **Work** |
| `quoteId` | referencia | — | apunta a **Quote** |
| `neededBy` | fecha | — | — |
| `priority` | texto | — | valores: `alta` · `media` · `baja` · por defecto `"media"` |
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
| `requestLines` | lista de objetos | — | — |
| `requestLines.stockItemId` | referencia | — | apunta a **StockItem** |
| `requestLines.name` | texto | — | — |
| `requestLines.unit` | texto | — | — |
| `requestLines.neededQty` | número | — | — |
| `requestLines.reservedQty` | número | — | — |
| `requestLines.shortageQty` | número | — | — |
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

### Facturas de compra y gastos

Colección `expenses` · entidad `expenses`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `number` | texto | — | — |
| `supplierId` | referencia | — | apunta a **Supplier** |
| `workId` | referencia | — | apunta a **Work** |
| `company` | texto | — | valores: `tvp` · `constructora` |
| `voucherType` | texto | — | valores: `factura_a` · `factura_c` · `factura_x` |
| `netCents` | número | — | — |
| `vatPct` | número | — | — |
| `vatCents` | número | — | — |
| `purchaseId` | referencia | — | apunta a **Purchase** |
| `receiptRef` | texto | — | — |
| `accountId` | referencia | — | apunta a **Account** |
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

### Facturas de venta

Colección `invoices` · entidad `invoices`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `company` | texto | — | valores: `tvp` · `constructora` · por defecto `"tvp"` |
| `voucherType` | texto | — | valores: `factura_a` · `factura_b` · `factura_x` · `factura_c` |
| `pointOfSale` | texto | — | — |
| `number` | texto | sí | — |
| `clientId` | referencia | sí | apunta a **Client** |
| `quoteId` | referencia | — | apunta a **Quote** |
| `workId` | referencia | — | apunta a **Work** |
| `certificateNumber` | texto | — | — |
| `description` | texto | — | — |
| `issueDate` | fecha | sí | — |
| `dueDate` | fecha | — | — |
| `netCents` | número | — | — |
| `vatPct` | número | — | — |
| `vatCents` | número | — | — |
| `amountCents` | número | — | mínimo 0 · por defecto `0` |
| `collectedCents` | número | — | mínimo 0 · por defecto `0` |
| `status` | texto | — | valores: `pendiente` · `parcial` · `cobrada` · `anulada` · `sustituida` · por defecto `"pendiente"` |
| `attachment` | texto | — | — |
| `replacesId` | referencia | — | apunta a **Invoice** |
| `replacedById` | referencia | — | apunta a **Invoice** |
| `remitoIds` | lista | — | — |
| `cae` | texto | — | — |
| `caeDueDate` | fecha | — | — |
| `arcaEnvironment` | texto | — | valores: `produccion` · `homologacion` |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Cobranzas

Colección `collections` · entidad `collections`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `number` | texto | — | — |
| `clientId` | referencia | sí | apunta a **Client** |
| `invoiceId` | referencia | — | apunta a **Invoice** |
| `allocations` | lista de objetos | — | — |
| `allocations.invoiceId` | referencia | sí | apunta a **Invoice** |
| `allocations.amountCents` | número | sí | mínimo 0 |
| `date` | fecha | sí | — |
| `amountCents` | número | — | mínimo 0 · por defecto `0` |
| `userName` | texto | — | — |
| `method` | texto | sí | valores: `transferencia` · `efectivo` · `cheque` · `retencion` · `otro` |
| `account` | texto | — | — |
| `reference` | texto | — | — |
| `notes` | texto | — | — |
| `accountId` | referencia | — | apunta a **Account** |
| `accountHistory` | lista de objetos | — | — |
| `accountHistory.fromId` | referencia | — | apunta a **Account** |
| `accountHistory.fromName` | texto | — | — |
| `accountHistory.toId` | referencia | — | apunta a **Account** |
| `accountHistory.toName` | texto | — | — |
| `accountHistory.reason` | texto | — | — |
| `accountHistory.userName` | texto | — | — |
| `accountHistory.at` | fecha | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Órdenes de pago y pagos

Colección `payments` · entidad `payments`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `number` | texto | — | — |
| `company` | texto | — | valores: `tvp` · `constructora` · por defecto `"tvp"` |
| `supplierId` | referencia | — | apunta a **Supplier** |
| `expenseId` | referencia | — | apunta a **Expense** |
| `status` | texto | — | valores: `emitida` · `pagada` · `anulada` · por defecto `"pagada"` |
| `date` | fecha | sí | — |
| `dueDate` | fecha | — | — |
| `amountCents` | número | — | mínimo 0 · por defecto `0` |
| `retentionsCents` | número | — | mínimo 0 · por defecto `0` |
| `method` | texto | sí | valores: `transferencia` · `efectivo` · `cheque` · `otro` |
| `account` | texto | — | — |
| `reference` | texto | — | — |
| `notes` | texto | — | — |
| `accountId` | referencia | — | apunta a **Account** |
| `accountHistory` | lista de objetos | — | — |
| `accountHistory.fromId` | referencia | — | apunta a **Account** |
| `accountHistory.fromName` | texto | — | — |
| `accountHistory.toId` | referencia | — | apunta a **Account** |
| `accountHistory.toName` | texto | — | — |
| `accountHistory.reason` | texto | — | — |
| `accountHistory.userName` | texto | — | — |
| `accountHistory.at` | fecha | — | — |
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
| `category` | texto | — | — |
| `description` | texto | sí | — |
| `accountId` | referencia | — | apunta a **Account** |
| `accountHistory` | lista de objetos | — | — |
| `accountHistory.fromId` | referencia | — | apunta a **Account** |
| `accountHistory.fromName` | texto | — | — |
| `accountHistory.toId` | referencia | — | apunta a **Account** |
| `accountHistory.toName` | texto | — | — |
| `accountHistory.reason` | texto | — | — |
| `accountHistory.userName` | texto | — | — |
| `accountHistory.at` | fecha | — | — |
| `company` | texto | — | valores: `tvp` · `constructora` |
| `workId` | referencia | — | apunta a **Work** |
| `costCenter` | texto | — | — |
| `transferId` | texto | — | — |
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

### Bienes de uso

Colección `assets` · entidad `assets`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `name` | texto | sí | — |
| `sector` | texto | — | valores: `albanileria` · `altura` · `pintura` · `aislamiento` · `general` · por defecto `"general"` |
| `category` | texto | — | valores: `vehiculo` · `maquinaria` · `herramienta` · `equipo` · `informatica` · `inmueble` · `otro` · por defecto `"vehiculo"` |
| `brand` | texto | — | — |
| `model` | texto | — | — |
| `identifier` | texto | — | — |
| `year` | número | — | — |
| `purchaseDate` | fecha | — | — |
| `valueCents` | número | — | mínimo 0 · por defecto `0` |
| `responsible` | texto | — | — |
| `location` | texto | — | — |
| `status` | texto | — | valores: `activo` · `en_reparacion` · `fuera_de_servicio` · `baja` · por defecto `"activo"` |
| `meterUnit` | texto | — | valores: `km` · `horas` · `ninguno` · por defecto `"ninguno"` |
| `currentReading` | número | — | mínimo 0 |
| `readingDate` | fecha | — | — |
| `notes` | texto | — | — |
| `attachment` | texto | — | — |
| `maintenance` | lista de objetos | — | — |
| `maintenance.date` | fecha | sí | — |
| `maintenance.kind` | texto | — | valores: `service` · `preventivo` · `reparacion` · `inspeccion` · `otro` · por defecto `"service"` |
| `maintenance.description` | texto | sí | — |
| `maintenance.costCents` | número | — | mínimo 0 · por defecto `0` |
| `maintenance.reading` | número | — | — |
| `maintenance.provider` | texto | — | — |
| `maintenance.notes` | texto | — | — |
| `maintenance.expenseId` | referencia | — | apunta a **Expense** |
| `maintenance.planId` | referencia | — | — |
| `maintenance.userId` | referencia | — | apunta a **User** |
| `maintenance.userName` | texto | — | — |
| `maintenance.createdAt` | fecha | — | — |
| `plans` | lista de objetos | — | — |
| `plans.title` | texto | sí | — |
| `plans.dueDate` | fecha | — | — |
| `plans.dueReading` | número | — | — |
| `plans.intervalMonths` | número | — | — |
| `plans.intervalReading` | número | — | — |
| `plans.notes` | texto | — | — |
| `plans.status` | texto | — | valores: `pendiente` · `hecho` · `cancelado` · por defecto `"pendiente"` |
| `plans.doneAt` | fecha | — | — |
| `plans.doneByName` | texto | — | — |
| `plans.maintenanceId` | referencia | — | — |
| `plans.createdByName` | texto | — | — |
| `plans.createdAt` | fecha | — | — |
| `plans.updatedAt` | fecha | — | — |
| `nextDueDate` | fecha | — | — |
| `nextDueTitle` | texto | — | — |
| `nextDueReading` | número | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### Plan de cuentas

Colección `accounts` · entidad `accounts`

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `code` | texto | sí | valores: `BB` · `CC` · `CE` · `CI` · `GGD` · `GGI` · `IMP` · `OP` |
| `name` | texto | sí | único |
| `direction` | texto | sí | valores: `ingreso` · `egreso` |
| `active` | sí/no | — | por defecto `true` |
| `notes` | texto | — | — |
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
| `permissions.seen` | lista | — | — |
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

Contadores para numeración correlativa: cotizaciones, órdenes de compra, recibos, remitos, órdenes de pago y caja. Colección `counters`.

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

### VoucherBook

Talonarios: qué comprobantes (A, B, C, X) usa cada empresa para vender y comprar, y en qué punto de venta. La X lleva acá su numeración interna. Colección `voucherbooks`.

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `company` | texto | sí | valores: `tvp` · `constructora` |
| `scope` | texto | sí | valores: `venta` · `compra` |
| `voucherType` | texto | sí | valores: `factura_a` · `factura_b` · `factura_c` · `factura_x` |
| `pointOfSale` | texto | — | por defecto `"0001"` |
| `fiscal` | sí/no | — | por defecto `true` |
| `lastNumber` | número | — | mínimo 0 · por defecto `0` |
| `active` | sí/no | — | por defecto `true` |
| `notes` | texto | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### StockTransfer

Transferencias entre depósitos: salen con remito, quedan en tránsito y el destino confirma lo recibido (con las diferencias). Colección `stocktransfers`.

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `number` | texto | sí | único |
| `from` | texto | sí | valores: `central` · `salon` |
| `to` | texto | sí | valores: `central` · `salon` |
| `status` | texto | — | valores: `en_transito` · `recibida` · `con_diferencias` · `anulada` · por defecto `"en_transito"` |
| `lines` | lista de objetos | — | — |
| `lines.stockItemId` | referencia | sí | apunta a **StockItem** |
| `lines.name` | texto | — | — |
| `lines.unit` | texto | — | — |
| `lines.quantity` | número | — | — |
| `lines.ownerParts` | lista de objetos | — | — |
| `lines.ownerParts.owner` | texto | — | valores: `tvp` · `constructora` · `sin_asignar` |
| `lines.ownerParts.quantity` | número | — | — |
| `lines.receivedQty` | número | — | — |
| `lines.damagedQty` | número | — | — |
| `lines.missingQty` | número | — | — |
| `lines.note` | texto | — | — |
| `note` | texto | — | — |
| `receptionNote` | texto | — | — |
| `sentAt` | fecha | — | — |
| `sentByName` | texto | — | — |
| `receivedAt` | fecha | — | — |
| `receivedByName` | texto | — | — |
| `quoteId` | referencia | — | apunta a **Quote** |
| `salesRemitoId` | referencia | — | apunta a **SalesRemito** |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### SalesRemito

Remitos de venta al cliente desde el Salón (y devoluciones). Descuentan el stock; la factura los referencia. Colección `salesremitos`.

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `number` | texto | sí | único |
| `kind` | texto | — | valores: `salida` · `devolucion` · por defecto `"salida"` |
| `company` | texto | — | valores: `tvp` · `constructora` · por defecto `"tvp"` |
| `clientId` | referencia | sí | apunta a **Client** |
| `quoteId` | referencia | — | apunta a **Quote** |
| `warehouse` | texto | — | valores: `central` · `salon` · por defecto `"salon"` |
| `date` | fecha | sí | — |
| `lines` | lista de objetos | — | — |
| `lines.stockItemId` | referencia | sí | apunta a **StockItem** |
| `lines.name` | texto | — | — |
| `lines.unit` | texto | — | — |
| `lines.quantity` | número | — | — |
| `lines.unitPriceCents` | número | — | mínimo 0 · por defecto `0` |
| `lines.totalCents` | número | — | mínimo 0 · por defecto `0` |
| `lines.unitCostCents` | número | — | — |
| `lines.ownerParts` | lista de objetos | — | — |
| `lines.ownerParts.owner` | texto | — | valores: `tvp` · `constructora` · `sin_asignar` |
| `lines.ownerParts.quantity` | número | — | — |
| `totalCents` | número | — | mínimo 0 · por defecto `0` |
| `status` | texto | — | valores: `pendiente` · `facturado` · `anulado` · por defecto `"pendiente"` |
| `invoiceIds` | lista | — | por defecto `[]` |
| `returnsId` | referencia | — | apunta a **SalesRemito** |
| `note` | texto | — | — |
| `userId` | referencia | — | apunta a **User** |
| `userName` | texto | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |

### StockReservation

Reservas de stock de una cotización aprobada. Las consumen las salidas a su obra; se liberan si la cotización se cae. Colección `stockreservations`.

| Campo | Tipo | Obligatorio | Detalle |
|---|---|:--:|---|
| `stockItemId` | referencia | sí | apunta a **StockItem** |
| `quoteId` | referencia | sí | apunta a **Quote** |
| `workId` | referencia | — | apunta a **Work** |
| `quantity` | número | sí | mínimo 0 |
| `consumedQty` | número | — | mínimo 0 · por defecto `0` |
| `status` | texto | — | valores: `activa` · `consumida` · `liberada` · por defecto `"activa"` |
| `userName` | texto | — | — |
| `createdAt` | fecha | — | — |
| `updatedAt` | fecha | — | — |
