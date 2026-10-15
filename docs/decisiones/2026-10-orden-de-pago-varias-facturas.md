# Orden de pago de varias facturas, notas de compra y obra por tipo de gasto

- **Fecha:** 2026-10-15
- **Estado:** aceptada (a confirmar con Tesorería los puntos de "Pendiente")
- **Afecta a:** [[../requerimientos/especificacion-v1-5]], [[../requerimientos/respuesta-v4]], [[../modelo-datos/esquema-actual]]

## Contexto

En la reunión con Tesorería de octubre de 2026, el responsable explicó el circuito de pagos con un
esquema a mano: la factura del proveedor se carga con su remito y su vencimiento; la orden de pago
empieza eligiendo al proveedor, muestra sus facturas pendientes y permite pagar algunas enteras y
otras en parte ("de esta total, de esta parcial"); lo que queda vuelve a aparecer en la próxima OP.
También pidió notas de débito y de crédito de compra para descontarlas en la OP, que la OP lleve el
tipo de gasto (CC, GGD, GGI…) y la caja (efectivo, banco, cheque o e-Cheq), y que un GGI o un bien
de uso no deje elegir cotización ni obra.

Hasta acá una OP pagaba una sola factura, las compras no tenían notas de débito ni de crédito y
ningún tipo de gasto controlaba la obra.

## Decisiones

**La OP guarda cuánto paga de cada comprobante.** `Payment.allocations` es la lista
`{ expenseId, amountCents }`, igual que `Collection.allocations` en los recibos. `amountCents` de la
OP es lo que cancela: facturas y notas de débito menos notas de crédito. `expenseId` queda con la
primera factura para lo que leía una sola. Las OP de antes, sin `allocations`, siguen valiendo con
su `expenseId`.

**Lo que está en una OP emitida no se vuelve a pagar.** Mientras la OP está emitida no descuenta
el saldo de las facturas, pero lo reserva: la grilla de la próxima OP muestra el saldo sin eso.

**Las notas de compra son comprobantes del proveedor.** `nota_debito_a/c` y `nota_credito_a/c` en
Facturas de compra, con la factura que corrigen (`associatedExpenseId`, opcional: misma letra y
proveedor). La de débito se paga como una factura; la de crédito se descuenta en la OP (lo
descontado queda en su `paidCents`) y resta en costos de obra, tablero, reportes y libro IVA.

**La OC nace al autorizarse la solicitud.** Es lo que dibujó Tesorería (Compra → OC → remito →
factura → OP) y lo que quedó anotado en la reunión (solicitud aprobada → OC → remito y factura →
OP). Reemplaza lo acordado antes en el grupo, donde la OP de Tesorería generaba la OC. Compras
recibe sin esperar una OP; Tesorería paga las facturas con la OP de facturas y, si es de contado
o lleva anticipo, con una OP contra la OC. Las solicitudes autorizadas antes del cambio, sin OC,
la reciben con su primera OP.

**Lo pagado contra la OC cubre sus facturas.** Para que no se pague dos veces, una OP de contado o anticipo contra la OC, sin factura, se aplica sola a las
facturas de esa OC cuando se cargan, la más vieja primero (`Expense.advanceCents`). Lo pagado de la
OC se calcula como esas OP más lo pagado de sus facturas, sin contar dos veces lo que cubrió el
anticipo.

**Obra según el tipo de gasto.** Con una cuenta GGI o BB (bienes de uso) no se puede elegir obra,
ni en la OP ni en la factura, y la factura no hereda la obra de su OC. CC y GGD no la exigen: el
pedido fue bloquearla en GGI y bienes de uso, y una compra para el depósito central todavía no es
de ninguna obra (el costo llega a la obra con el remito de salida).

**El cheque queda registrado.** El medio de pago suma e-Cheq. Pagar con cheque o e-Cheq pide
número, banco y fecha de cobro, y deja el cheque emitido en Tesorería › Cheques (`Check.format`,
`Check.paymentId`).

## Pendiente

- Confirmar con Tesorería si CC y GGD tienen que exigir obra siempre.
- Retenciones en una OP de varias facturas: hoy se cargan sobre el total de la OP.
- Una nota de crédito que no se va a descontar (el proveedor devuelve la plata): hoy sólo se
  descuenta en una OP.
- Cuenta corriente de proveedores (saldo por proveedor, vencidas y por vencer) como reporte propio.
