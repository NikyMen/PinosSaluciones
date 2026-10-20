# Impuestos en la solicitud de compra

- **Fecha:** 2026-10-19
- **Estado:** aceptada
- **Afecta a:** [[../requerimientos/especificacion-v1-5]], [[../requerimientos/respuesta-v4]], [[../modelo-datos/esquema-actual]], [[2026-10-orden-de-pago-varias-facturas]]

## Contexto

En la reunión con Tesorería de octubre de 2026 quedaron anotados estos pedidos para la solicitud
de compra:

1. IVA a elegir: 21 %, 10,5 % o 27 %.
2. Percepciones de IVA (por ejemplo 3 %), de IIBB (por ejemplo 2 %) e IIBB provincial (por ejemplo
   1,5 %), con el porcentaje editable.
3. Impuesto interno, que arranca en 0 % y se puede cambiar.
4. El total no se escribe a mano: sale del neto más los impuestos y las percepciones.
5. De contado, elegir el medio: efectivo o transferencia. El plazo en días ya se podía escribir (los
   botones de plazos fijos se descartaron).

Hasta acá la solicitud del buscador de precios tenía renglones sin IVA y el IVA fijo al 21 %; la
cargada a mano tenía un solo campo, "Importe (con IVA)", que se escribía. No había percepciones ni
impuestos internos.

## Decisiones

**El IVA va por renglón; las percepciones y el impuesto interno, por solicitud.** Cada renglón lleva
su alícuota (`items[].vatPct`); la solicitud tiene la suya (`vatPct`), que vale para los renglones
que no dicen otra y para la cargada a mano, que no tiene renglones. Las percepciones y el impuesto
interno van una vez por solicitud, con su porcentaje sobre el neto total, como vienen en la factura
del proveedor.

**El total sale de una sola cuenta** (`src/lib/purchase-taxes.ts`): neto + IVA de cada alícuota +
percepciones + impuesto interno. La usan el pedido y el formulario para mostrarlo en vivo, el
servidor para guardarlo y el PDF. El IVA se calcula por alícuota sobre la suma de sus renglones. Se
guardan los porcentajes y los importes (`perceptionVatPct` / `perceptionVatCents`,
`perceptionIibbPct` / `perceptionIibbCents`, `perceptionIibbProvPct` / `perceptionIibbProvCents`,
`internalTaxPct` / `internalTaxCents`) y `amountCents` es la suma. La OC los copia al nacer.

**La solicitud a mano se carga por el neto.** El campo "Importe (con IVA)" pasó a "Neto (sin IVA)" con
el IVA, las percepciones y el impuesto interno; el total es de sólo lectura. Lo que llega por la API
con sólo el total (lo de antes, una importación) se sigue tomando como total con IVA al 21 %, y el
neto sale de ahí.

**Las percepciones arrancan en 0 %.** No todos los proveedores son agentes de percepción: se cargan
cuando el proveedor las cobra.

**El límite de $500.000 se mide sobre el total**, con IVA, percepciones e impuesto interno: es lo que
se paga.

**De contado se dice el medio** (`cashMethod`: efectivo o transferencia). Sin él la solicitud de
contado no se emite. Tesorería lo ve en el aviso y la OP contra la OC lo trae elegido. A plazo o en
cuenta corriente no lleva medio.

**Lo de antes no cambia.** Las solicitudes y OC que ya existen conservan su total. Las que no tienen
el detalle se leen al 21 %, con el neto que sale del total, en la ficha, el PDF y el formulario.

## Pendiente

- Percepciones en la factura de compra y su columna en el libro IVA compras.
- Que la factura de compra se cargue con los importes de su OC.
- Guardar en cada proveedor los porcentajes que suele percibir, para que se carguen solos.
