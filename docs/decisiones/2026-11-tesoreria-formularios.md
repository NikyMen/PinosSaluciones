# Tesorería y Compras: formularios como en el papel

- Fecha: 2026-11-16.
- Origen: reunión con Tesorería y con Compras del 10/11/2026 (etapa 2 del plan en `docs/reuniones/2026-11-10-ronda-cristian-jorge-fede-fer.md`).
- Capturas: `docs/cambios/2026-11-16-tesoreria/index.html`, sección "Etapa 2".

## Factura de compra

- **Número 4 + 8.** La letra la da el comprobante (A, C o X) y se muestra fija al lado. El número son 4 dígitos, guion y 8 (12 en total). Se acepta tipeado sin guion o con la letra adelante, y se guarda como `0001-00012345` (`purchaseVoucherNumber`, `src/lib/document-rules.ts`). Una factura de antes con otro formato se puede editar sin tocar el número; si se cambia, tiene que cumplir el formato.
- **Fechas.** "Fecha de la factura" va debajo del número y "Vencimiento" debajo del proveedor.
- **Estado.** Al cargar no se elige: sale de las órdenes de pago. Al editar queda, para anular una factura cargada por error.
- **Factura que corrige.** Aparece solo en notas de crédito y débito. Vacía significa "sin referencia" (queda a cuenta).
- **Percepciones por importe.** Las percepciones de IVA, IIBB e IIBB provincial y el impuesto interno se cargan por importe (`perceptionVatCents`…), como figuran en la factura. Sólo el IVA va en porcentaje. El porcentaje se sigue guardando, calculado sobre el neto, para el libro IVA y lo que ya lo leía. Lo que llega sólo con porcentaje (por la API o heredado de la OC) se calcula como antes (`voucherTaxFields`, `src/lib/purchase-taxes.ts`).
- **"Descripción" pasa a "Leyenda".**

## Orden de pago

- **En el menú Compras**, debajo de Facturas de compra (antes estaba en Tesorería).
- **Tipo de gasto y obra desde la factura.** Con una factura elegida, se toman de ella y no se piden. Sólo se eligen en una OP a cuenta o con facturas viejas que no los tienen.
- **Sin "Pago".** Se sacó "Pagarla ahora / Dejarla emitida": la OP se paga con la fecha que se pone, que puede ser de días anteriores. Una OP que ya estaba emitida sigue emitida al editarla.
- **Cheques.** El medio "e-Cheq" ya no se ofrece en la OP (va como "Cheque": por el número se sabe si es electrónico). Las OP de antes con e-Cheq se siguen viendo y editando igual. El cheque propio sólo se elige de una cuenta de cheques diferidos (códigos 20–29 y 40–49).
- **Campos a la vista.** Los campos de cada medio van en blanco, con borde y con texto de ayuda.

## Solicitud de compra

- **"Los precios ya incluyen IVA"** (pedido de Jorge). Con la casilla tildada, el costo y el descuento del ítem se escriben con IVA y se guarda el neto (`unitCents`), así el IVA no se suma dos veces. Puede haber un centavo de diferencia por redondeo. La casilla no se guarda: es una forma de cargar.

## Facturas de venta

- Al cargar no se elige el estado (sale de los recibos). Al editar queda, para anular.

## Despliegue

- No requiere migración: los campos nuevos son opcionales y las facturas guardadas ya tenían el importe de cada percepción.
