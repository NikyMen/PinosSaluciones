# Plan: historial del hilo de documentos

Pedido del 23/11/2026. Origen: el circuito que dibujó Fer en la reunión del 10/11 (ver `docs/reuniones/2026-11-10-ronda-cristian-jorge-fede-fer.md`, sección 4.1). La factura es el documento central, y los documentos se asocian **en cualquier orden**: hacia adelante y hacia atrás.

## Qué se quiere

Desde **cualquier** documento del hilo, un botón **Historial** que muestre todo lo que está atado a él, ordenado por fecha, para seguir qué se hizo primero y qué después.

Los cuatro conjuntos:

| Conjunto | Documentos | Colección |
|---|---|---|
| 1. Cotización / Obra | Cotización, Obra | `Quote`, `Work` |
| 2. Compras | Solicitud (SC), Orden de compra (OC), Remito de compra, Factura de compra, NC/ND | `Purchase` (stage solicitud/orden), `PurchaseReceipt`, `Expense` |
| 3. Ventas | Remito de venta, Factura de venta, NC/ND, Venta de mostrador (VM) | `SalesRemito`, `Invoice`, `CounterSale` |
| 4. Tesorería | Orden de pago (OP), Recibo, Cheques | `Payment`, `Collection`, `Check` |

Hoy sólo la factura de compra tiene **Vinculado** (`src/lib/expense-links.ts`, `src/components/expense-links.tsx`), que lista la OC, la cotización, la obra, los remitos y las OP, sin fechas ni orden.

## Cómo se ve

Una línea de tiempo vertical, la más vieja arriba:

```
03/11  Cotización COT-12 · aprobada por Cristian · $ 4.500.000
05/11  Solicitud SC-23 · Jorge · $ 121.000
06/11  OC-29 · aprobada por Jorge
08/11  Remito de compra R-0001-00001234 · 40 bolsas
10/11  Factura A 0004-00001520 · Fer · $ 121.000   ← asociada a la OC el 12/11
15/11  OP-40 · pagada · $ 121.000
```

- Cada renglón lleva un ícono y un color según su conjunto (los mismos 4 del gráfico), el número, la fecha, quién lo cargó, el importe y el estado (anulado y corregido tachados, con la referencia al que lo reemplaza).
- Un clic abre el documento en su pantalla (`?ver=<id>`, como ya hacen las notificaciones).
- Si se asoció después, aparece en **su** fecha con la marca "asociado el dd/mm por …". Así se ve el orden real de carga y no sólo el orden "ideal".
- Arriba, un resumen corto: total cotizado, comprado, facturado, pagado y cobrado del hilo.
- Filtro por conjunto (chips: Cotización, Compras, Ventas, Tesorería).
- Sólo aparecen los documentos de módulos que la persona puede leer (`canRead`). Del resto se muestra "1 documento de Tesorería sin acceso", sin datos.

## Cómo se arma (sin datos nuevos)

Los vínculos ya existen en la base. El historial es una **consulta**, no una colección nueva.

1. **Raíz del hilo.** Desde el documento abierto se sube hasta la cotización/obra si la tiene (`quoteId`, `workId`, `Work.quoteId`, `Quote.workId`). Si no tiene (factura sin OC, OP a cuenta, recibo de anticipo), el hilo arranca en el propio documento.
2. **Se expande en los dos sentidos** con los campos que ya hay:
   - Cotización/Obra → `Purchase.quoteId/workId`, `PurchaseReceipt.quoteId/workId`, `Expense.quoteId/workId`, `SalesRemito.quoteId/workId`, `Invoice.quoteId/workId`.
   - Solicitud ↔ OC: `Purchase.requestId/orderId`.
   - OC → remitos: `PurchaseReceipt.purchaseId`; OC → facturas: `Expense.purchaseId`, `Expense.purchaseReceiptIds`.
   - Factura de compra → OP: `Payment.expenseId`, `Payment.allocations.expenseId`; OC → OP: `Payment.purchaseId/requestId`.
   - Remito de venta ↔ factura: `SalesRemito.invoiceIds`, `Invoice.remitoIds`, `Invoice.remitoLines`.
   - Factura de venta → recibo: `Collection.invoiceId`, `Collection.allocations.invoiceId`.
   - NC/ND → factura: `Expense.associatedExpenseId`, `Invoice.associatedInvoiceId`; factura reemplazada: `Invoice.replacesId/replacedById`.
   - Cheques: `Check.paymentId`, `Check.collectionId`.
   - Mostrador: `CounterSale.remitoId/invoiceId/collectionId`.
   - Corrección de compras: el texto `Corrige la SC-n` del `history`. **Hace falta un campo** (ver abajo).
3. **Tope:** el recorrido para a los 200 documentos y avisa "hilo muy grande, filtrá por conjunto". Una obra grande puede tener cientos de compras.
4. **Fechas:** se usa la fecha del documento (emisión, recepción, pago) y, si no tiene, `createdAt`.
5. **"Asociado después":** se toma de la bitácora (`Audit`, acción `associate`, que ya graba `src/app/api/expenses/[id]/links/route.ts`) y del `history` de cada documento. Donde una asociación hoy no deja rastro (editar la OP para aplicarla a una factura, editar el recibo), se suma un `audit` en ese guardado.

### Cambios chicos de datos (opcionales, sin migración)

- `Purchase.correctsId`: la compra nueva apunta a la que corrigió. Hoy sólo queda en el texto del historial. Las viejas se resuelven leyendo ese texto una vez.
- Un `audit(..., "associate", ...)` en los guardados de OP y recibo cuando cambian la factura aplicada.

## Piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Lógica | `src/lib/document-thread.ts` | `documentThread(kind, id, session)`: arma el grafo, lo filtra por permisos y devuelve los renglones ordenados |
| API | `src/app/api/thread/[kind]/[id]/route.ts` | `GET`, con `requireSession` |
| Pantalla | `src/components/document-thread.tsx` | Modal con la línea de tiempo, los chips y el resumen |
| Botón | listas y fichas | **Historial** en cotización, obra, compra (`purchase-detail.tsx`), remito de compra y de venta, factura de compra y de venta, OP, recibo y venta de mostrador |
| Vinculado | `expense-links.tsx` | Queda igual (sirve para **asociar**); el Historial va al lado |

## Etapas

1. **Lógica y tests.** `document-thread.ts` con tests de servidor sobre un hilo completo (cotización → SC → OC → remito → factura → OP, y cotización → remito de venta → factura → recibo) y sobre los casos fuera de orden: factura sin OC asociada después, OP a cuenta aplicada después, recibo de anticipo, compra corregida y NC.
2. **API y modal**, con el botón primero en la factura de compra y en la compra (lo que más usan Fer y Jorge).
3. **Botón en el resto** de los documentos.
4. **Rastro de asociaciones**: `audit` en OP y recibo, y `correctsId` en las compras corregidas.
5. **Documentación**: `README.md`, `AGENTS.md` (Producción), `docs/decisiones/2026-11-historial-de-documentos.md` y una nota en el acta del 10/11.

**Hecho cuando** desde cualquier documento del hilo se abre el Historial, se ven todos los documentos vinculados en orden de fecha, con quién y cuánto, los fuera de orden marcados como "asociado después", y cada renglón abre su documento.

## Decidido al implementarlo (23/11/2026)

Hecho el 23/11/2026: ver `docs/decisiones/2026-11-historial-de-documentos.md`.

1. Lo ve todo el que puede leer el documento, y en el hilo sólo aparece lo que puede leer.
2. Va en una ventana, como Vinculado. Los links de cada renglón abren el documento (o su lista filtrada con `?buscar=`).
3. Sólo comprobantes: los movimientos de stock no entran.
4. El rastro de asociaciones de la OP y el recibo ya quedaba en la bitácora (sus ediciones guardan el antes y el después), así que no hubo que sumar nada.
