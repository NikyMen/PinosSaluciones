# Multi-CUIT, depósitos con tránsito, Factura X y plan de cuentas

- **Fecha:** 2026-10-05
- **Estado:** aceptada
- **Afecta a:** [[../requerimientos/especificacion-v1-5]], [[../requerimientos/stock]], [[../requerimientos/administracion]], [[../modelo-datos/esquema-actual]]

## Contexto

La especificación v1.5 de administración pide no fijar ninguna relación entre la empresa que
compra, la dueña del material y la que factura; que toda compra entre al Depósito Central; que
la venta al público salga del Salón con remito y que la factura lo referencie; un comprobante
interno X; y que todo ingreso o egreso de plata se impute a una cuenta del plan.

## Decisiones

**El dueño del stock se lleva por ubicación, no por material.** `StockItem.owners` guarda
`{ central: { tvp, constructora, sin_asignar }, salon: {…}, transito: {…} }`, siempre cuadrado con
las cantidades por depósito (`src/lib/stock-owners.ts`). Lo que había antes queda "sin asignar":
no se inventa un dueño. El costo sigue siendo un promedio único por material (la valuación por
CUIT es una decisión pendiente).

**La transferencia tiene dos pasos.** Sale del origen y queda en `transitQty` con un
`StockTransfer` en tránsito; el destino confirma lo que llegó. Lo dañado pasa a `unusableQty` y
lo que faltó queda anotado en el renglón. Anular una transferencia en tránsito devuelve todo al
origen. El pase directo entre depósitos ya no existe.

**El remito de venta es lo que mueve el stock; la factura no.** `SalesRemito` descuenta del Salón
y la factura guarda `remitoIds`. Anular la factura devuelve los remitos a "para facturar".

**La X es un tipo de comprobante más, con talonario propio.** `VoucherBook` define, por empresa y
punto de venta, qué tipos se usan para vender y comprar. La X toma su número del talonario en el
servidor (atómico) y se guarda como `X-0001-00000001` para no chocar con el número de una
fiscal. El índice único de facturas pasó a empresa + tipo + número + cliente; el índice viejo
(número + cliente) lo borra `src/lib/db.ts` al conectar. La sustitución de una X por una fiscal
deja la X en estado `sustituida` y mueve los recibos a la fiscal: no se duplica deuda ni cobro.

**El plan de cuentas es un catálogo, no texto libre.** `Account` se carga sola con el Anexo A la
primera vez que se usa. Caja y bancos, recibos y pagos exigen `accountId`; CI solo para ingresos.
Cambiar la cuenta de algo guardado pide el motivo y lo agrega a `accountHistory`. Un pase entre
cuentas propias son dos movimientos con el mismo `transferId`, y los reportes de flujo los
excluyen (no es ingreso ni gasto de la empresa).

**La orden de pago descuenta recién cuando se paga.** `Payment.status` emitida / pagada / anulada;
los pagos de antes no tienen estado y cuentan como pagados.

**Reservar es al aprobar, no al cotizar.** Mirar el stock desde la cotización no reserva nada.
Aprobar reserva lo disponible (`StockReservation` + `StockItem.reservedQty`) y deja una solicitud
de compra con el faltante. Las salidas a la obra de esa cotización consumen la reserva; si la
cotización vuelve a otro estado que no sea "aprobada" o "convertida", se libera.

## Consecuencias

- Producción no necesita migración de datos: catálogo y talonarios se crean solos, el índice viejo
  se borra solo, y lo histórico sigue funcionando (sin cuenta / sin dueño hasta editarlo).
- Las entradas al Salón por compra dejan de ser posibles. Si alguien las usaba, ahora es
  "entrada al Central + transferencia".
- Facturar un remito por partes, notas de crédito y OP de varias facturas quedan para después.
