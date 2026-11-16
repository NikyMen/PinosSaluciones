# Tesorería: OP y recibo a cuenta, cheque de terceros con sobrante, facturas viejas y facturas pagadas

- Fecha: 2026-11-13.
- Origen: reunión con Tesorería del 10/11/2026 (etapa 1 del plan en `docs/reuniones/2026-11-10-ronda-cristian-jorge-fede-fer.md`).

## OP a cuenta (sin factura)

- Problema: se paga antes de que llegue la factura (por ejemplo, la OP sale en octubre y la factura llega en noviembre por el cierre de ARCA), pero la OP pedía "al menos una factura". Tesorería tenía que inventar una factura para poder avanzar.
- Decisión: la OP tiene `onAccountCents`, lo que se paga sin factura. `amountCents` = facturas y notas de débito − notas de crédito + lo que va a cuenta. Una OP puede ir toda a cuenta. Como en ese caso no hay facturas de las que sacar la empresa, se elige (`company`).
- Cuando llega la factura, **se edita la OP y se elige la factura**: se paga con la plata a cuenta y el total de la OP no cambia (la pantalla lo descuenta sola). Al armar otra OP del mismo proveedor, aparece un aviso con las OP que tienen plata a cuenta, para no pagar dos veces.
- El PDF de la OP muestra "De eso, a cuenta (sin factura)" y, si no paga ninguna factura, "Sin factura: a cuenta".

## Cheque de terceros que vale más que lo que se paga

- Problema: el cheque de terceros se endosa entero y la OP no dejaba seguir si el cheque pasaba lo que se pagaba.
- Decisión: el cheque se sigue endosando entero (no se puede partir) y **la diferencia queda a cuenta del proveedor** en esa misma OP. Al elegir el cheque, la pantalla completa sola el importe a cuenta. Después se aplica a la próxima factura editando esa OP.
- En la reunión también se habló de que "el cheque siga con el saldo que le queda". Eso es lo mismo que la plata a cuenta de la OP: el cheque ya lo tiene el proveedor. Si Tesorería quiere otra cosa, hay que volver a hablarlo.

## Recibo a cuenta

- Antes, el recibo a cuenta existía solo si el cliente no tenía facturas pendientes, y no guardaba la empresa.
- Decisión: el recibo tiene `onAccountCents` y `company`. El importe a cuenta se puede cargar siempre, solo o junto con facturas. Cuando se emite la factura, se edita el recibo y "Todo" en la factura la cobra con la plata a cuenta. El PDF muestra el renglón "Pago a cuenta".

## Facturas emitidas viejas

- Problema: no se podía cargar a mano una factura emitida vieja. Del lado del servidor, una A o B "de Tango" con fecha vieja se guardaba bien. En la pantalla, la opción que venía elegida era "Emitir ahora en ARCA" y el número venía bloqueado. ARCA no autoriza con fecha de más de 5 días atrás (productos) o 10 (servicios).
- Decisión: la opción se llama **"Cargar una ya emitida (Tango o vieja): escribo el número"**, y al elegirla el número queda libre para escribirlo. Si se intenta emitir en ARCA una factura con fecha fuera de ese plazo, el sistema lo explica y dice que se cargue como ya emitida (`emitInvoiceInArca`, `src/lib/invoice-service.ts`).

## Factura recibida con o sin orden de pago

- Pedido de Tesorería: una factura recibida que no tiene OP se corrige entera, incluida la fecha. La que tiene OP queda como se pagó: solo se cambia la leyenda (descripción). Para cambiar el resto, se anula la OP.
- Decisión: con una OP no anulada que la pague (`expenseId` o `allocations`), solo se cambian `description`, `attachment` y `files`. Lo demás devuelve 409 y nombra la OP. Tampoco se borra. Lo que el formulario reenvía sin cambios (o vacío) no cuenta como cambio (`checkPaidExpenseChanges`, `src/lib/document-rules.ts`).

## Arreglos que salieron al revisar las pantallas (16/11/2026)

- El lápiz de una OP toda a cuenta (sin facturas) abría el formulario genérico, donde no se puede elegir la factura. Ahora abre la pantalla de la orden de pago (`src/components/entity-manager.tsx`).
- En los formularios de registros, el mensaje de error quedaba al final del formulario, tapado por el pie de "Guardar cambios", y parecía que no pasaba nada. Ahora se desplaza solo hasta quedar a la vista.
- Las pantallas que cambiaron, con capturas: `docs/cambios/2026-11-16-tesoreria/index.html`.

## Despliegue

- No requiere migración: `onAccountCents` vale 0 por defecto y los recibos viejos sin facturas siguen leyéndose como a cuenta (lo que no se aplicó a facturas).
