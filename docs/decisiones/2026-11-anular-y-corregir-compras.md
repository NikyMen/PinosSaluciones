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

Código: `cancelPurchase` y `correctPurchase` en `src/lib/purchase-flow.ts`, `POST /api/purchases/[id]/cancel` y `/correct`. Despliegue: `deploy/compras-stock.md`.
