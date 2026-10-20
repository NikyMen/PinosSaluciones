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

**La factura de compra lleva lo mismo** (20/10/2026). `Expense` guarda las percepciones y el impuesto
interno como la solicitud (porcentaje e importe). Con el neto cargado, el total es neto + IVA +
percepciones + impuesto interno (`voucherTaxFields`). El IVA va sólo en la A y sus notas (antes las
notas A quedaban sin IVA); la C y la X no lo discriminan, pero sí pueden traer percepciones. Un costo
interno, sin comprobante, no lleva IVA. Sin neto (un costo interno, una factura de antes) se sigue
cargando el total.

**La factura sale de su OC.** "Cargar factura" desde la ficha de la OC abre la factura con el neto, la
alícuota y los porcentajes de la OC; se ajusta el neto si la factura es parcial y las percepciones
se recalculan. Por la API, lo que no venga (alícuota, porcentajes) se toma de la OC.

**El libro IVA compras suma columnas.** Además de neto, IVA y total: percepción de IVA, percepción de
IIBB, IIBB provincial e impuesto interno, también en la exportación. La nota de crédito las resta.

## Pendiente

- Una factura con dos alícuotas de IVA: hoy lleva una sola. Si la OC mezcla alícuotas, la factura
  se abre con la de la solicitud y hay que cargarla como dos comprobantes o ajustar a mano.
- Guardar en cada proveedor los porcentajes que suele percibir, para que se carguen solos.
