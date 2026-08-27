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

Generado el 2026-08-27 · 17 colecciones.

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
| `certificates.approved` | sí/no | — | — |
| `certificates.invoiced` | sí/no | — | — |
| `certificates.file` | texto | — | — |
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

### Trabajadores

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
| `avgCostCents` | número | — | mínimo 0 · por defecto `0` |
| `valueCents` | número | — | mínimo 0 · por defecto `0` |
| `supplierId` | referencia | — | apunta a **Supplier** |
| `location` | texto | — | — |
| `notes` | texto | — | — |
| `active` | sí/no | — | por defecto `true` |
| `movements` | lista de objetos | — | — |
| `movements.kind` | texto | sí | valores: `ingreso` · `egreso` · `ajuste` |
| `movements.quantity` | número | sí | — |
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
| `passwordHash` | texto | sí | — |
| `role` | texto | sí | valores: `gerencia` · `arquitecto` · `auxiliar` · `administracion` · `compras` · `ventas` · `contador` |
| `active` | sí/no | — | por defecto `true` |
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
