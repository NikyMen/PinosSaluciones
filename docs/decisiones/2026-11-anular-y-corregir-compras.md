# Anular y corregir compras aprobadas

- Fecha: 2026-11-20.
- Pedido: Compras aprobó una solicitud "cargar a stock después de aprobar" con el proveedor equivocado. No la podía editar (una solicitud emitida queda en sólo lectura) ni anular (la aprobación ya había cargado el remito de ingreso, y Anular rechazaba toda OC con mercadería recibida).

## Anular

- La anula, con motivo, quien la podría aprobar (hasta $500.000 quien gestiona compras o tiene Autorizar compras; por encima, sólo Gerencia): la misma regla que para aprobarla. Antes era sólo de Gerencia; se amplió el 20/11/2026 porque Compras aprueba sus compras chicas y también tiene que poder deshacerlas. No anula lo que ya tiene pagos hechos.
- La compra a proveedor con remitos recibidos sigue sin anularse: eso se resuelve con el proveedor (devolución, nota de crédito).
- La compra **cargar a stock después de aprobar** (`stockOnApproval`) sí se anula aunque tenga el remito interno, mientras:
  - no tenga la factura del proveedor (ni por la OC ni por el remito), y
  - lo que entró siga en el depósito. Si ya se usó, se vendió o se trasladó, el error dice cuánto entró y cuánto queda, y se corrige con un ajuste antes.
- Al anularla, el remito queda anulado (`PurchaseReceipt.cancellation`) y cada material sale del mismo depósito con el movimiento `ingreso_anulado`, a su costo, que también se saca del costo promedio. El remito anulado no aparece para facturar y la factura lo rechaza. El último precio de compra del material ignora la compra anulada.

## Corregir

- En la ficha de la compra, quien puede anularla y cargar solicitudes tiene **Corregir** junto a **Anular**. Pide qué hay que corregir y hace las dos cosas:
  1. anula la compra, con las mismas reglas de arriba (deshace el stock si lo cargó la aprobación), y
  2. crea una solicitud nueva (`SC-n` nuevo) en borrador con los mismos datos, renglones e impuestos, y la abre para editar.
- La nueva se edita como cualquier borrador y se vuelve a emitir y aprobar: si es a stock, el ingreso se hace de nuevo con los datos corregidos.
- Se eligió anular y copiar en vez de editar la OC aprobada para no dejar el remito, los movimientos de stock, el costo y el historial apuntando a datos que cambiaron. El historial de las dos dice cuál reemplaza a cuál.

## Cambiar proveedor

- Pedido del 20/11/2026: Compras se equivoca de proveedor y no tiene que rehacer toda la compra para corregirlo. En la ficha de la compra, junto a **Corregir**, está **Cambiar proveedor**. Lo puede usar quien podría anularla: hasta $500.000 quien gestiona compras o tiene Autorizar compras, y por encima, sólo Gerencia.
- Sirve mientras la compra esté emitida o aprobada y la orden no tenga órdenes de pago ni facturas del proveedor, que ya quedaron a su nombre. Si las tiene, se anulan primero o se usa Corregir. En borrador, el proveedor se cambia editando.
- No anula nada ni crea documentos nuevos. Cambia el proveedor en la solicitud y la orden, en sus remitos, en los ingresos a stock que dejó la orden y en los materiales dados de alta con ella. Deja de figurar la lista de precios del proveedor anterior, pero los precios cargados quedan. Las dos compras registran "Proveedor cambiado: anterior → nuevo" en el historial, y se avisa a Compras y Administración (evento `compra.proveedor`).
- La solicitud que nace de **Corregir** guarda a cuál reemplaza (`correctsId`), y el historial del hilo de documentos la sigue.

Código: `changePurchaseSupplier`, `POST /api/purchases/[id]/supplier`, `cancelPurchase` y `correctPurchase` en `src/lib/purchase-flow.ts`, `POST /api/purchases/[id]/cancel` y `/correct`. Despliegue: `deploy/compras-stock.md`.
