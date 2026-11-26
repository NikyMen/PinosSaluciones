# Pendientes de la ronda del 10/11: envío de una venta, notas sin referencia, planificación de obra y salida a un bien de uso

- Fecha: 2026-11-26.
- Pedido: cerrar lo que quedó a medias (◐) en el acta de la ronda del 10/11 (`docs/reuniones/2026-11-10-ronda-cristian-jorge-fede-fer.md`) y en `docs/plan-envios-y-traslados.md`. El plan, con los botones de cada punto, está en `docs/plan-pendientes-26-11.html`.

## 1. Envío por transporte de un remito de venta (J6)

- Pedido de Ventas (16/11): las ventas por internet salen por Correo Argentino o Mercado Libre y necesitan el mismo remito de envío con valor declarado que las encomiendas de Compras. El envío de Stock › Envíos no servía, porque baja el stock y la venta ya lo había bajado con su remito.
- En **Ventas › Remitos de venta**, cada remito de salida que no está anulado tiene el botón **Enviar por transporte**. Abre el formulario con el destino (la dirección y el nombre del cliente, o la obra), quién recibe, el transporte, los bultos y los materiales del remito.
  - Las cantidades son las del remito y no se cambian. Un material que salió del Salón y del Galpón (dos renglones en el remito) va en un solo renglón.
  - El **valor declarado** arranca con el precio neto de cada renglón (con su descuento) y se puede cambiar. En una entrega a obra, que no lleva precio, arranca con el costo.
  - **Despachar** crea el `ENV-n` atado al remito (`Shipment.salesRemitoId`) y baja el PDF. **No mueve stock.**
- El remito muestra **Enviado · ENV-n** y, cuando se carga, la guía. El envío aparece en Stock y logística › Envíos con "Venta · remito R-…", y la guía se carga ahí como en cualquier envío.
- Un remito tiene **un solo envío vigente**. Si se anula el envío, se puede hacer otro.
- **Anular** el envío de una venta sólo lo anula: el material no vuelve al depósito, porque eso lo hace la devolución o la anulación del remito. Un remito con un envío vigente no se anula: primero se anula el envío.
- Lo puede despachar quien tiene permiso de escritura en Stock o en Facturas de venta (`POST /api/remitos/[id]/shipment`). Cargar la guía y anular el envío de una venta, lo mismo.
- El envío entra en el **Historial** del hilo de documentos (tipo `shipment`, en Ventas), después del remito. Los envíos a una obra aparecen en el historial de la obra.
- Vale también para las ventas del Mostrador: su remito está en Remitos de venta con el mismo botón.
- Pruebas: `tests/envio-venta.test.ts`.
