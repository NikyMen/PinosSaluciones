# Historial del hilo de documentos

- Fecha: 2026-11-23.
- Pedido: seguir el hilo de los papeles de punta a punta. En la reunión del 10/11, Fer dibujó el circuito con la factura en el centro e insistió en que los documentos se asocian en cualquier orden: la factura puede llegar antes que la OC, la OP antes que la factura y el recibo antes que la cotización. Hacía falta un lugar donde ver qué se hizo primero y qué después. Plan: `docs/plan-historial-de-documentos.md`.

## Qué hace

- Botón **Historial** en cada documento de los cuatro conjuntos:
  - Cotización / Obra: en la cotización se llama **Documentos vinculados**, porque ya tenía un Historial de versiones; en la obra, **Historial de documentos**.
  - Compras: solicitud y OC (en la lista y en la ficha), remito de compra y factura de compra.
  - Ventas: remito de venta y factura de venta.
  - Tesorería: orden de pago y recibo.
- Abre una línea de tiempo con todos los documentos vinculados, del más viejo al más nuevo. Cada uno muestra su fecha, tipo, número, estado, importe, quién lo cargó y un color por conjunto. Lo anulado sale tachado.
- Lo que se cargó fuera de orden aparece en su fecha, con la marca **"Asociado a … el dd/mm por …"**. También quedan a la vista las correcciones, los reemplazos y los cambios de proveedor de las compras.
- Arriba muestra los totales del hilo: cotizado, comprado (OC), facturas de compra, pagado, facturado y cobrado. Se puede filtrar por conjunto.
- Cada número es un link al documento: la compra abre su ficha, la cotización y la obra sus páginas, y las listas (facturas, OP, recibos y remitos) se abren filtradas por el número (`?buscar=`).

## Decisiones

- **Sin colección nueva.** El hilo se arma en cada consulta con los vínculos que ya existen, en los dos sentidos: `quoteId`, `workId`, `requestId`/`orderId`, `purchaseId`, `purchaseReceiptIds`, `allocations`, `remitoIds`/`invoiceIds`, `associatedExpenseId`/`associatedInvoiceId`, `replacesId`, los de la venta de mostrador y `correctsId`.
- **La cotización y la obra no se abren desde un comprobante.** Desde una factura se ven su cotización y su obra, pero no el resto de las compras de esa obra. Desde la cotización o la obra sí se ve todo. Sin esto, una factura de combustible traía la obra entera.
- **"Asociado después" sale de la bitácora.** Es el vínculo que aparece en el `after` de un registro de la bitácora y no estaba en su `before`: la asociación de la factura a la OC o a la cotización (`associate`), la OP editada para aplicarla a una factura y el recibo aplicado. Esas ediciones ya quedaban en la bitácora, así que no hubo que sumar nada.
- **`Purchase.correctsId`**: la solicitud que nace de Corregir apunta a la compra que reemplaza. Las corregidas antes de este cambio se encuentran por el texto del historial ("Corrige la SC-n").
- **Permisos:** lo ve todo el que puede leer el documento, y en el hilo sólo aparecen los documentos de los módulos que esa persona puede leer. De los otros se dice cuántos hay por conjunto, sin datos, y el recorrido no sigue por ellos.
- **Tope de 200 documentos**, con aviso, para que una obra grande no trabe la pantalla.
- Va en una **ventana**, como Vinculado. Los movimientos de stock (entradas al Galpón, salidas a obra) no entran: el hilo es de comprobantes.

Código: `src/lib/document-thread.ts`, `GET /api/thread/[kind]/[id]`, `src/components/document-thread.tsx`. Tests: `tests/historial-documentos.test.ts`.
