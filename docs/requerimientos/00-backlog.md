# Backlog

Orden de desarrollo **definido por el cliente** en [[../reuniones/2026-08-relevamiento-inicial]]:

1. [[cotizaciones]] y [[obras]] — *"de la cotización parte nuestro costo"*
2. [[stock]] y compras
3. [[administracion]] (incluye [[personal]])
4. Dashboard — explícitamente postergado

Módulos nuevos que surgieron: [[logistica]] · [[bienes-de-uso]]

La especificación funcional v1.5 de administración (octubre 2026) ordena todo en trece módulos y
suma multi-CUIT, depósitos con tránsito, remitos de venta, Factura X y plan de cuentas. Estado
punto por punto: [[especificacion-v1-5]].

El **Requerimiento Funcional Integral v4** (7/10/2026) suma el circuito de compras con autorización desde
$500.000, el maestro de cajas y bancos, la facturación parcial de cotizaciones, los certificados por ítem,
la bandeja de avisos y la clasificación financiera por documento. Se entrega en ocho etapas; la respuesta
al cliente, con las etapas y las preguntas abiertas, está en [[respuesta-v4]]. Donde el PDF y lo conversado
en el grupo de clientes no coinciden, manda el grupo.

## Estado por módulo

| Módulo | Requerimientos | Nuevo o existente |
|---|---|---|
| [[cotizaciones]] | 11 | Existe, hay que ampliarlo fuerte |
| [[obras]] | 8 | Existe, faltan certificados y personal |
| [[stock]] | 7 | **Nuevo** |
| [[personal]] | 7 | **Nuevo** |
| [[administracion]] | 4 | Existe, hay que reorganizarlo |
| [[logistica]] | 4 | **Nuevo** |
| [[bienes-de-uso]] | 3 | **Nuevo** |

## Convención de prioridad

- **P0** — bloquea la próxima demo
- **P1** — comprometido, no bloquea
- **P2** — acordado a futuro, sin fecha
- **?** — necesita definición antes de estimarse
