# Stock, productos y compras

**Módulo nuevo.** Prioridad 2. Vive dentro de Compras.

Reemplaza a **Tango**, que la empresa dejó de renovar. *"Nadie quiere trabajar con Tango."*

| ID | Requerimiento | Prio |
|---|---|---|
| STK-1 | **Catálogo de productos** con código de artículo, denominación, unidad, cantidad y costo | P1 |
| STK-2 | El catálogo **alimenta los precios** del costeo en [[cotizaciones]] | P1 |
| STK-3 | **Ingreso a stock al cargar la factura de compra**, con el costo real | P1 |
| STK-4 | **Egreso contra remito** cuando el material sale a la obra → descuenta stock y carga costo en [[obras]] | P1 |
| STK-5 | **NO se debita automáticamente** al aprobar la obra. Decisión explícita del cliente | P1 |
| STK-6 | **Alerta de stock mínimo** → notificación a compras | P2 |
| STK-7 | **Venta rápida / mostrador**: vender productos del stock sin pasar por obra | P2 |

## Valorización

Cada ingreso registra el **costo real** del material. Objetivo declarado: *"saber cuánto tengo valorizado"* y que ese costo impacte en la cotización.

## Categorías a definir

El cliente pidió `materiales e insumos` en un módulo y `bienes de uso` en otro ([[bienes-de-uso]]), pero dejó la taxonomía abierta:

- **Materiales** — pintura, entonadores, revoque, membrana, espuma. Se consumen
- **Insumos** — andamios, silletas, cuerdas, EPP. Se usan y vuelven
- **Bienes de uso** — vehículos y maquinaria

> Pendiente P5 del acta: el cliente dijo que después define cuáles son los insumos.

## Venta al público

Segundo negocio, hoy dormido, que quieren reactivar: venta de productos a consumidor final y ferreterías. *"Hay gente que viene acá y compra los tachos esos que están ahí."*

Mecánicamente es el mismo stock: cambia que el egreso va a una venta en vez de a una obra. Requiere factura A / B / X y cobro contra entrega.

## Disparador desde obra

Cuando una cotización se convierte en obra, compras y logística deben recibir el aviso con los materiales necesarios y la fecha de inicio, para tener todo en obra el día uno.
