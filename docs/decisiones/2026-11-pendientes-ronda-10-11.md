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

## 2. Notas de crédito y débito sin referencia, y saldo a favor del cliente (V2)

- Pedido de Fer (10/11): en Ventas, las notas "con o sin referencia", como en Compras. Hasta ahora toda nota pedía una factura asociada y la de crédito no podía pasar de lo que se debía de esa factura, porque el saldo a favor del cliente no existía.
- **Factura que corrige** (sólo en notas, al crearlas):
  - **Con referencia**: se elige la factura, como antes. Si la nota de crédito es por más de lo que se debe, ya no se rechaza: cancela lo que se debe y **el resto queda a favor del cliente**.
  - **Sin referencia**: no lleva factura. Lleva el **período que corrige** (desde y hasta; por defecto, del primer día del mes a la fecha de la nota). La nota de crédito queda **entera a favor del cliente**; la de débito queda como una deuda más, pendiente de cobro, y aparece en el recibo como cualquier factura.
  - La referencia no se cambia después de guardar.
- **ARCA**: sin factura asociada, la nota va con `PeriodoAsoc` (FchDesde y FchHasta) en lugar de `CbtesAsoc`, después del bloque de IVA. El período no puede pasar de la fecha de la nota; se controla antes de pedir el CAE.
- **Saldo a favor** (`Invoice.creditCents` en la nota de crédito, `src/lib/credit-notes.ts`):
  - La nota sigue "aplicada" y con `collectedCents` igual a su importe, como antes: así no aparece como pendiente en ningún reporte. Lo que tiene sin aplicar es `creditCents`.
  - Facturas de venta suma el recuadro **A favor de clientes** (cantidad de notas e importe). Al tocarlo se ven esas notas, con "A favor $ …" en la columna Saldo.
  - **Aplicar a una factura** (en la fila de la nota): una factura o nota de débito pendiente del **mismo cliente y la misma empresa**, por todo o una parte. Baja lo que se debe de la factura (como un cobro) y el saldo de la nota. Queda en `creditApplications` con fecha y usuario, y en la bitácora.
  - **Deshacer** una aplicación devuelve el saldo a la nota y la factura vuelve a deber ese importe.
  - **En el recibo**: al elegir el cliente se ve su saldo a favor con **Usar**. Se aplica en el momento a una factura (no espera a que se guarde el recibo) y el recibo cobra el resto.
  - No es plata: el importe del recibo (`amountCents`) no cambia y no suma en lo cobrado de tableros y reportes. El **PDF del recibo** lo detalla aparte, en "Compensado con notas de crédito (no es plata recibida)".
- **Lo que no se puede**: anular o borrar una nota de crédito con saldo aplicado a otras facturas, ni borrar una factura que tiene saldo a favor aplicado. Primero se deshace la aplicación. Una nota de una empresa no paga facturas de la otra.
- **Devoluciones**: en Remitos de venta, la devolución de un remito facturado con A o B tiene **Hacer nota de crédito**. Abre la nota con el tipo de la letra de la factura, la factura asociada, el cliente y lo devuelto cargado como conceptos (el stock ya volvió con la devolución). Una factura X no lleva nota de crédito.
- Queda afuera: devolverle la plata al cliente (reintegro). El saldo a favor sólo se descuenta de otra factura.
- Los comprobantes anteriores no cambian: una nota de crédito de antes no tiene `creditCents` y sigue aplicada entera a su factura.
- Pruebas: `tests/invoices-receipts.test.ts` (notas sin referencia, saldo a favor, recibo), `tests/arca.test.ts` (`PeriodoAsoc`) y `tests/envio-venta.test.ts` (nota de crédito de una devolución).

## 3. Planificar la obra al aprobar la cotización (F8)

- Pedido de Fede (10/11): cuando se aprueba la cotización, que le llegue la obra para asignarle fechas y personal. El aviso ya le llegaba, pero lo llevaba a la cotización; la obra la creaba "Pasar a obra" (con permiso de Cotizaciones, sólo con código, nombre e inicio) y la duración y el personal se cargaban después, cada uno en otra pantalla.
- **Planificar obra** es un solo panel (`src/components/plan-work-modal.tsx`, `src/lib/work-planning.ts`, `/api/works/plan`):
  - Inicio previsto, duración en días hábiles y fin previsto. Con el inicio y la duración, el fin se calcula de lunes a viernes y sin feriados; si se elige el fin, se calcula la duración.
  - Responsable de la obra: un usuario activo (`Work.managerId`).
  - Personal: se eligen personas activas de los legajos. Entran con el jornal o valor hora de su legajo, que después se puede cambiar por obra como siempre.
  - Nota opcional, que sale en el aviso a Compras y Administración.
- **Guardar planificación**:
  - Si la cotización aprobada todavía no tiene obra, la crea igual que Pasar a obra (presupuesto, rubro, ubicación y fotos de la cotización; la cotización queda "convertida"). El código se propone como `OB-<número de cotización>` y se puede cambiar.
  - Guarda fechas, responsable y personal, deja una entrada en la actividad de la obra y queda en la bitácora (`plan_work`).
  - Da por resuelto el aviso de Producción de esa cotización (si la obra quedó con personal).
  - Avisa a Compras y Administración la fecha de inicio, la primera vez y cada vez que cambia.
- **Permiso**: el de Obras. Producción no necesita el de Cotizaciones para crear la obra desde la planificación. Pasar a obra sigue igual, con el permiso de Cotizaciones.
- **Dónde está el botón**: en la cotización aprobada (Planificar obra), en cada obra pendiente, en curso o pausada del listado (Planificar) y en la ficha de la obra. El aviso de Producción abre el panel directo (`/app/works?planificar=<cotización>`). Obras muestra arriba las cotizaciones aprobadas que todavía esperan su obra.
- **Sin planificar**: una obra pendiente de inicio sin fecha de inicio o sin personal. El listado la marca y tiene el filtro "Sin planificar", con la cantidad.
- **Otras obras en esas fechas**: si una persona ya está asignada a otra obra viva que se pisa con las fechas elegidas (o que no tiene fechas), el panel lo avisa en su renglón. No bloquea.
- **Volver a planificar**: el mismo botón cambia fechas, responsable y gente. Quien ya tiene horas cargadas en la obra no se saca (el panel lo muestra y el aviso de guardado lo dice).
- Se asigna el personal para toda la obra; las horas de cada día siguen en el parte diario. No se planifica una obra terminada, cerrada o cancelada.
- Pruebas: `tests/planificar-obra.test.ts`.
