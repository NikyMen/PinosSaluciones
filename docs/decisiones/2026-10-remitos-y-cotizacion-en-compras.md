# Remitos en la factura de compra y cotización de venta en la OC

- **Fecha:** 2026-10-20
- **Estado:** aceptada
- **Afecta a:** [[../requerimientos/especificacion-v1-5]], [[../modelo-datos/esquema-actual]], [[2026-10-impuestos-solicitud-compra]]

## Contexto

En la reunión con Tesorería de octubre de 2026, Fer dibujó el circuito Compra → OC (proveedor y
referencia a la cotización de venta) → remito → factura de compra → orden de pago. Todo estaba en el
sistema, pero dos pasos quedaban a medias:

- En la factura de compra, el remito se escribía como texto ("Remito o conformidad"). No se elegía de
  los remitos que Compras ya cargó en la OC, y nada controlaba que se facture lo que llegó.
- La solicitud guardaba la cotización de origen, pero el PDF de la OC sólo la mostraba si la compra
  tenía obra, y la ficha de la compra no la mostraba.

## Decisiones

**La factura elige los remitos de su OC** (`Expense.purchaseReceiptIds`). Al elegir la OC aparecen
sus remitos para tildar; una factura nueva arranca con los que todavía no están en otra factura. El
servidor rechaza un remito de otra OC y, si se cambia la OC, suelta los remitos de la anterior. Si
"Remito o conformidad" queda vacío, se completa con el número de los remitos elegidos. El texto
sigue para una conformidad sin remito o una factura de antes.

**Avisa, no bloquea, si se factura más de lo recibido.** Lo recibido se valoriza a precio de la OC
(sin IVA). Con remitos elegidos, compara el neto de la factura contra ellos; sin elegir, compara lo
facturado de toda la OC (las notas de crédito restan) contra todo lo recibido. Si la OC no tiene
remitos, avisa que se factura algo que no llegó. Es un aviso porque hay casos válidos: un anticipo,
un flete, una OC cargada a mano sin productos.

**La compra guarda el número de la cotización de venta** (`Purchase.quoteNumber`). Se completa al
elegir la cotización en la solicitud, desde el pedido del buscador (la de la obra) y en el faltante
de una cotización aprobada. La OC lo copia. La ficha muestra "Para la cotización de venta COT-n" y el
PDF lo imprime aunque la compra no tenga obra.

## Pendiente

- Pedir la cotización al armar el pedido desde el buscador de precios cuando no se elige obra.
