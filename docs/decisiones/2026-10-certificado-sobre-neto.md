# Los certificados se calculan sobre el neto

- **Fecha:** 2026-10-08
- **Estado:** aceptada
- **Afecta a:** [[../requerimientos/obras]], [[../modelo-datos/certificado-obra]], [[../requerimientos/respuesta-v4]]

## Problema

El precio de la cotización (`amountCents`) incluye el IVA: la cascada lo calcula como subtotal 3 más IVA.
La obra heredaba ese precio como presupuesto y cada certificado era un porcentaje de él. Después, el
borrador de la factura del certificado tomaba ese importe como **neto** y le sumaba el 21 % otra vez.
Un certificado del 30 % de una obra de $1.210.000 terminaba facturado en $439.230 en lugar de $363.000.

## Decisión

- La cotización guarda su **neto** (`netCents`). La cascada escribe su subtotal 3. Una cotización cargada
  a mano lo calcula como importe / 1,21.
- La obra guarda su **presupuesto neto** (`budgetNetCents`) al convertirse. En las obras de antes se
  calcula al leerlas: sale del neto de la cotización o, si no, del presupuesto sin IVA.
- El certificado es un porcentaje del presupuesto neto. El importe lo calcula el **servidor**, salvo
  que se ajuste a mano. La factura le suma el IVA **una sola vez**.
- El servidor rechaza un certificado si el porcentaje acumulado de la obra pasa del 100 % o si repite el número.

## Además, en el mismo cambio

- La factura queda atada al certificado **por id** (`certificateId`), no por el número tipeado.
- Si esa factura se anula o se borra, el certificado vuelve a "pendiente de facturar" y se reabren su
  tarea y su aviso, salvo que otra factura vigente lo facture.
- Los remitos de venta se toman para la factura uno por uno antes de guardarla (`claimRemitos`): si dos
  facturas quieren el mismo remito a la vez, una se frena.

## Lo que no cambia

Los certificados ya cargados conservan su importe. Si alguno se calculó sobre el precio con IVA y
todavía no se facturó, se corrige a mano al facturarlo.
