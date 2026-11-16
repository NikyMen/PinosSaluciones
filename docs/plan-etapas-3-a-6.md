# Plan de trabajo: etapas 3 a 6 (reunión del 10/11/2026)

Plan para ejecutar las etapas que faltan del relevamiento con Cristian, Jorge, Fede y Fer. Las etapas 1 y 2 ya están hechas y commiteadas en la rama `feat/tesoreria-reunion-10-11`. Las decisiones que estaban abiertas se respondieron el 16/11/2026 y están incluidas acá.

- Pedidos originales y su código (R1, P2, V5…): `docs/reuniones/2026-11-10-ronda-cristian-jorge-fede-fer.md`.
- Lo hecho en las etapas 1 y 2: `docs/decisiones/2026-11-tesoreria-a-cuenta.md` y `docs/decisiones/2026-11-tesoreria-formularios.md`.
- Capturas de lo hecho: `docs/cambios/2026-11-16-tesoreria/index.html`.

---

## 0. Antes de empezar (leer siempre)

**Reglas del proyecto** (están en `AGENTS.md`, que es la fuente de verdad):

- Next.js de una versión nueva, con cambios: antes de tocar rutas o APIs de Next, leer la guía en `node_modules/next/dist/docs/`.
- Textos de la app, comentarios, commits y documentación en **español rioplatense**. Commits con el estilo `feat: ...` / `fix: ...`.
- **El repo es público**: nada de IPs, usuarios, contraseñas ni datos de acceso en archivos versionados.
- Cada cambio de comportamiento se documenta en todos lados: `README.md`, `AGENTS.md` (sección Producción), `docs/decisiones/AAAA-MM-tema.md` (una por etapa) y el estado en `docs/reuniones/2026-11-10-ronda-cristian-jorge-fede-fer.md` (cambiar 🆕/◐ por ✅ con la fecha).
- Importes siempre en centavos (`*Cents`) y se muestran con `money()` de `src/lib/format.ts`.
- No hace falta migración si los campos nuevos son opcionales: preferir eso.

**Cómo correrlo:**

- `pnpm install`, después `pnpm dev`: levanta una MongoDB local propia (`.mongo-data/`, nunca la del VPS), el seed, la web y el worker.
- Tests: `npx vitest run --dir tests`. El `--dir tests` es necesario: hay una copia vieja en `.claude/worktrees/` cuyos tests fallan y no hay que mirarlos.
- Hay un test que ya falla antes de estos cambios y no hay que arreglarlo acá: `tests/tesoreria-anexo.test.ts` › "el listado de TANGO completa por CUIT…". A veces algún test da timeout con la máquina cargada; si corrido solo pasa, no es un problema.
- Chequeo de tipos: `npx tsc --noEmit -p .`. Lint: `npx eslint src`.
- Para probar en el navegador, crear un usuario de prueba solo en la base local (un script con `mongoose` + `bcryptjs` que haga upsert en `users` con rol `gerencia`). No usar la clave del admin del `.env`.

**Cómo trabajar cada etapa:**

1. Leer los archivos que se nombran y los tests parecidos en `tests/` (los de órdenes de pago y compras: `tests/orden-pago-proveedor.test.ts`, `tests/circuito-compras.test.ts`).
2. Hacer el cambio del servidor (modelo, servicio, reglas) con su test.
3. Hacer el cambio de pantalla.
4. Probar en la app local con datos de ejemplo.
5. Documentar y hacer un commit por etapa en la misma rama.

---

## Etapa 3: remitos y vínculos entre documentos (prioridad P1)

**Regla de Fer:** la **factura es el centro**. Desde la factura se ve todo: OC, cotización, OP y remitos. Desde la OP solo se ve la factura. Los documentos se tienen que poder asociar en cualquier orden.

### 3.1 Factura "con remito" y "sin remito" (R1, V1)

- **Decisión:** lo elige quien carga. En Compras › Facturas de compra hay dos botones: **"Factura con remito"** y **"Factura sin remito"**.
- **Con remito:** obliga a elegir al menos un remito de compra ya cargado por Jorge. Es para materiales y bienes de uso.
- **Sin remito:** servicios (luz, agua, higiene y seguridad, consultoría…). No pide remito.
- Guardar el modo en la factura (por ejemplo `Expense.withRemito: Boolean`) y validarlo en el servidor (`prepareExpense` en `src/lib/document-rules.ts`).
- En **ventas** lo mismo: "Factura" (servicio y mano de obra) y "Factura con remito" (productos del salón, con el remito de venta que descuenta stock). Ya existe `Invoice.remitoIds` y el borrador de factura desde remitos (`src/app/api/invoices/draft/route.ts`, `src/components/invoice-fields.tsx`): solo hay que exponer los dos botones y hacer obligatorio el remito en el modo "con remito".

### 3.2 Remitos de compra sueltos, con obra (R2, J5)

- **Decisión:** el remito de compra puede existir **sin OC**, pero con **proveedor y obra (o cotización) obligatorios**.
- Hoy `PurchaseReceiptSchema.purchaseId` es `required` (`src/lib/models.ts`, cerca de la línea 735) y el alta está en `registerPurchaseReceipt` (`src/lib/purchase-flow.ts`). Hacer `purchaseId` opcional, agregar `supplierId`, `workId`/`quoteId` y renglones propios (material, cantidad, unidad) para el remito suelto. El que viene de una OC sigue igual.
- Pantalla: Compras › Remitos de compra (`src/app/app/remitos-compra/`, `src/components/purchase-receipts-view.tsx`), con un botón **"Remito sin OC"**.
- Al cargar una **factura con remito**:
  - Mostrar **todos los remitos del proveedor sin facturar**, incluso de meses anteriores, para tildar varios.
  - Al tildarlos, listar sus artículos para **ponerles precio**: el neto de la factura sale de ahí.
  - Hoy la factura solo elige remitos de su OC (`checkExpenseReceipts` en `src/lib/document-rules.ts` y `ExpenseFields` en `src/components/purchase-fields.tsx`). Hay que ampliarlo a los remitos sueltos del mismo proveedor.
- **Control:** lo pedido (OC) contra lo recibido (remitos) contra lo facturado. Si la factura cobra más de lo recibido, avisar (ya hay un aviso parecido en `ExpenseFields`).

### 3.3 Factura desde la OC con todo bloqueado menos los precios (R3)

- Al cargar la factura desde una OC: la obra, el proveedor, la empresa y los artículos vienen de la OC y **no se pueden cambiar**. Solo se editan los precios, por diferencias de IVA.
- Hoy la OC completa empresa, proveedor y obra (`prepareExpense`), pero se pueden cambiar. Bloquearlos en el formulario y validarlo en el servidor.

### 3.4 Asociar después: factura → OC o cotización (R4)

- **Decisión:** desde la factura. En cada factura de compra sin OC, un botón **"Asociar a OC / cotización"** que permita elegir una OC o una cotización existente del mismo proveedor (u obra).
- Al asociar: completar la obra y el rubro desde la cotización y recalcular lo pagado de la OC (`refreshOrderPayment` en `src/lib/purchase-flow.ts`).
- La OP ya se asocia a la factura editando la OP (etapa 1, `onAccountCents`): no hace falta otro camino.

### 3.5 Desde la factura se ve todo

- En la ficha o en el historial de la factura de compra, una sección "Vinculado" con su OC, la cotización y obra, las OP que la pagan y los remitos, cada uno con link.
- En la OP se muestra solo la factura que paga (ya es así).

### 3.6 Rubro de la obra (R5)

- **Decisión:** por ahora seis rubros, pero **la lista tiene que ser editable** porque falta confirmarla con Fer: Trabajo en altura, Albañilería, Pintura interior, Pintura exterior, Impermeabilización, Poliuretano/Poliurea.
- Crear una lista administrable, por ejemplo una colección `WorkCategory` con nombre y activo, en Configuración › Empresas y comprobantes o en una pantalla chica parecida a `src/components/work-types-modal.tsx`. **No** usar `WorkType`: esos son tipos de trabajo con tarifa para la quincena, no rubros.
- El rubro es **obligatorio en la cotización** (`QuoteSchema` en `src/lib/models.ts` y el formulario de cotización), pasa a la obra y llega **bloqueado** a la solicitud/OC y a la factura de compra. En las pantallas donde dice "Obra", mostrar "Cotización / Obra".
- Las cotizaciones viejas sin rubro siguen funcionando: pedirlo recién al editarlas o al aprobarlas.

**Hecho cuando:** se puede cargar un remito sin OC, facturarlo eligiendo varios remitos pendientes y poniendo precios, asociar una factura sin OC a una OC después, y ver desde la factura todo lo vinculado. Con tests de servidor para el remito sin OC, la factura con remito obligatoria y la asociación posterior.

---

## Etapa 4: indicadores y documentos (prioridad P1)

### 4.1 Contadores de facturas (T1, T2)

- En **Compras › Facturas de compra** y en **Ventas › Facturas de venta**, arriba de la lista, dos recuadros: **"Facturas recibidas"** (o "emitidas") con la cantidad y **"Pendientes"** en rojo, con la cantidad y el total.
- Al hacer clic en Pendientes se filtra la lista y se ve el saldo de cada una.
- Pendiente es mientras quede algo por pagar o cobrar, aunque sea un peso: `amountCents − paidCents > 0` en compras y `amountCents − collectedCents > 0` en ventas, sin contar anuladas ni sustituidas.
- Se puede armar como un endpoint de resumen o como filtro de la lista genérica (`src/components/entity-manager.tsx` y `src/app/api/records/[entity]/route.ts`).

### 4.2 Facturado y cobrado por cotización (V5)

- En la cotización y en la obra, un indicador de **cuánto se facturó** (parcial o total) y **cuánto se cobró**, y cuánto falta de cada cosa.
- Ya existe el cálculo de lo facturado por cotización (`loadQuoteBilling` en `src/lib/quote-billing-service.ts`): sumarle lo cobrado (los recibos de esas facturas, `src/lib/balances.ts`) y mostrarlo.
- En cada factura de venta, lo cobrado y lo que falta (ya está `collectedCents`; mostrarlo claro en la lista).

### 4.3 PDF del recibo (V7)

- Archivos: `src/lib/receipt-pdf.ts` y `receiptPdfData` en `src/lib/receipt-service.ts`.
- **Encabezado:** número de recibo, fecha de cobro, datos del cliente y factura asociada.
- **Medios:** un renglón por medio con su caja o cuenta (por ejemplo "Transferencia · Mercado Pago", "Banco de Corrientes"). Cada cheque con número, banco y fecha de cobro. Después las retenciones (ya están).
- **Total abajo**, que tiene que dar igual al de las facturas aplicadas más lo que va a cuenta.
- **Firma.** Decisión: **nombre y cargo impresos** con línea de firma, por ejemplo "Flores Fernando – Responsable de Tesorería". Se configura por empresa en Configuración › Empresas y comprobantes; agregar los campos a donde se guardan los datos de la empresa. Usar la misma firma en el PDF de la OP (`src/lib/payment-order-pdf.ts`).

### 4.4 Permisos de Fer y Ricci (R14)

- **Decisión:** ven las **órdenes de compra en solo lectura** (no aprueban ni editan) y pueden cargar facturas y órdenes de pago.
- Revisar `src/lib/permissions.ts` (roles, `defaultPermissionsForRole`, `USER_ACTIONS`) y la pantalla de usuarios (`src/components/users-admin.tsx`). Probablemente alcanza con el rol Administración más ver Compras sin `edit` en `purchases`.
- Que Gerencia pueda **editar el nombre de un usuario** desde Seguridad › Usuarios. Revisar si hoy deja (`PATCH /api/users/[id]`) y, si no, habilitarlo.

**Hecho cuando:** se ven los contadores en las dos listas, la cotización muestra facturado y cobrado, el recibo sale con medios, total y firma, y el usuario de Administración ve las OC sin poder tocarlas. Con tests de los contadores y del total del recibo.

---

## Etapa 5: ventas del salón y cotización operativa (prioridad P1)

### 5.1 Facturar desde Ventas con conceptos (C1, C2)

- En **Ventas › Facturas de venta**, la factura se arma por renglones:
  - **Productos del salón** desde Stock (con precio de venta).
  - **Conceptos de texto libre** (decisión): descripción, cantidad, unidad (m², ml, unidad, hora…) y precio unitario.
- Botón **"Nuevo cliente"** dentro del formulario, sin salir: alta rápida, ya existe un mecanismo de alta rápida para relaciones en `entity-manager.tsx` (`quickCreate`).
- Campo de **descripción u observaciones** ("El trabajo comprende…").
- **Descargar el PDF.** Si se emite en ARCA, el PDF fiscal (`src/lib/fiscal-invoice-pdf.ts`) tiene que mostrar los renglones. Para una X o una ya emitida, el PDF interno (`src/lib/invoice-pdf.ts`).
- Hoy la factura de venta se carga por neto total (`src/components/invoice-fields.tsx`). Agregar los renglones (por ejemplo `Invoice.lines`) y que el neto salga de ellos. Las facturas viejas sin renglones siguen por total.

### 5.2 Remito de venta hacia una obra (C3)

- Sacar insumos del Salón de Ventas hacia una obra con un remito que firma Jorge y que baja el stock.
- Ya existen los remitos de venta (`src/components/sales-remitos-view.tsx`) y las salidas a obra (`/app/salidas`). Revisar si alcanza con permitir "obra" como destino del remito de venta y que pida la firma (nombre de quien retira).

### 5.3 Aviso al aprobar la cotización (C4, F8)

- Cuando Cristian aprueba la cotización, avisar a Jorge (Compras), a Fede (Obras) y a Fer (Administración). Solo es un aviso: no aprueban nada.
- Ya existe `noticeQuoteApproved` (se llama desde `src/app/api/records/[entity]/[id]/route.ts`). Revisar a qué roles avisa y sumar los que falten.
- A Fede le llega para asignar fechas y personal a la obra.

### 5.4 Insumos sin stock en la cotización (C5)

- Cristian puede cargar en la cotización los insumos que necesita la obra (tachos, rodillos, lija, sellador, fijador) **aunque no estén en stock** ni en el catálogo.
- **Decisión:** al aprobar la cotización, **notificación a Compras (Jorge)** con la lista de lo que falta, para que arme la solicitud. No se crea una solicitud automática.
- Ya hay reserva de stock al aprobar (`reserveForQuote`). Sumar el aviso con lo faltante y permitir ítems que no están en el catálogo.

### 5.5 Productos del salón desde el Excel (C6)

- **Bloqueado:** Cristian tiene que mandar el Excel. Cuando llegue, usar la importación genérica (botón Plantilla en Stock, `src/app/api/import/[entity]/route.ts`) o un script como `scripts/import-galpon-stock.ts`.

**Hecho cuando:** se factura desde Ventas con productos y conceptos y se baja el PDF, el remito hacia obra baja stock, y al aprobar una cotización les llegan los avisos a Compras, Obras y Administración, con lo que falta en stock para Compras.

---

## Etapa 6: obras (prioridad P2)

### 6.1 Presupuesto en el listado de obras (F5)

- **Decisión:** mostrarlo a **Gerencia y a Fede**. Antes de hacerlo, buscar en el historial (`git log -S budgetCents`, commit `9118229` y `deploy/obras.md`) por qué se ocultó. Si nadie pidió ocultarlo, mostrarlo a todos.
- Para Fede: un permiso de acción "Ver presupuesto de obras" en `USER_ACTIONS` (`src/lib/permissions.ts`), que se le da por persona en Seguridad › Usuarios, y la columna visible si el usuario es Gerencia o tiene ese permiso.
- En el listado, además: sacar la columna "Notificar", achicar "Estado" y sumar la duración.
- Actualizar el renglón de Obras en `AGENTS.md` (hoy dice "listado y edición sin presupuesto") y en `docs/requerimientos/obras.md` y `deploy/obras.md`.

### 6.2 % escrito en la barra de avance (F3)

- Mostrar el número ("30 %") sobre la barra roja proporcional del listado de obras.

### 6.3 Duración en días hábiles (F4)

- **Decisión:** **solo lunes a viernes**. Sábados, domingos y feriados nacionales no cuentan.
- Se carga la duración en días hábiles y el sistema calcula el fin previsto (`endDate`) desde el inicio previsto (`startDate`), y al revés.
- Lista de feriados nacionales editable (por año) en Configuración, con los de 2026 cargados.
- Función pura, por ejemplo `src/lib/business-days.ts`, con tests: inicio un miércoles con 25 días hábiles da el fin correcto, salteando fines de semana y feriados.

### 6.4 Foto, ubicación y mapa de obras (F6, F7)

- **Foto:** cargar una o más fotos en la cotización (ya hay adjuntos y fotos en otras partes: `.photo-picker` en `globals.css`, uploads en `/api/uploads`). Pasan a la obra.
- **Ubicación:** decisión: la carga **Cristian en la cotización** (link de Google Maps o dirección) y pasa a la obra. Fede la puede corregir en la obra. Guardar la URL y, si se puede, latitud y longitud sacadas del link.
- Botón "Cómo llegar" que abre Google Maps.
- **Mapa de obras dentro del sistema, solo para usuarios** (decisión). Muestra las obras con su % de avance y color por estado (en ejecución, pendiente, terminada). Si hace falta una librería de mapas, usar Leaflet con OpenStreetMap, que no pide clave. No cargar scripts de terceros sin versión fija.

**Hecho cuando:** el listado de obras muestra presupuesto según quién mira, el % en la barra y la duración, el fin se calcula en días hábiles con feriados, y hay mapa con las obras ubicadas.

---

## Decisiones tomadas el 16/11/2026

| Tema | Decisión |
|---|---|
| Factura con o sin remito | Lo elige quien carga, con dos botones |
| Remitos de compra | Pueden ser sueltos, con proveedor y obra obligatorios |
| Rubros | Los seis de la lista, editable hasta confirmarla con Fer |
| Factura antes que la OC | Se asocia después desde la factura |
| Firma en recibo y OP | Nombre y cargo impresos |
| Fer y Ricci | Ven las OC sin gestionarlas; cargan facturas y OP |
| Conceptos de venta | Texto libre |
| Insumos sin stock | Aviso a Compras al aprobar la cotización |
| Presupuesto en obras | Gerencia y Fede (o todos, si nadie pidió ocultarlo) |
| Días hábiles | Lunes a viernes, sin feriados |
| Mapa de obras | Dentro del sistema; la ubicación la carga Cristian |
| Cheque de terceros que sobra | Queda a cuenta del proveedor en la OP (confirmado) |

## Pendientes de otros

- **Excel de productos del salón:** lo manda Cristian (etapa 5.5).
- **Lista definitiva de rubros:** la confirma Fer (etapa 3.6). Hasta entonces se usa la lista editable.

## Al terminar cada etapa

1. `npx tsc --noEmit -p .`, `npx eslint src` y `npx vitest run --dir tests` sin errores nuevos.
2. Probado en la app local con datos de ejemplo.
3. Documentación al día: `docs/decisiones/2026-11-<tema>.md`, `README.md`, `AGENTS.md` y el estado en `docs/reuniones/2026-11-10-ronda-cristian-jorge-fede-fer.md`.
4. Opcional: sumar las capturas a `docs/cambios/2026-11-16-tesoreria/index.html` o a una página nueva igual.
5. Un commit por etapa en la rama `feat/tesoreria-reunion-10-11`, en español (`feat: …`). Sin push ni deploy hasta que el usuario lo pida.
