# Cotizaciones

Módulo existente (`quotes`). Es la **prioridad 1** junto con [[obras]]: es donde nace el costo de la empresa.

Modelos de referencia: [[../modelo-datos/cotizador-cascada]] · [[../modelo-datos/cotizacion-pdf]]

| ID | Requerimiento | Prio | Estado |
|---|---|---|---|
| COT-1 | **Número automático.** Hoy es obligatorio y manual | P0 | ✅ hecho |
| COT-2 | **Bloquear conversión a obra si el estado no es `aprobada`** | P0 | ✅ hecho |
| COT-3 | **Pop-up de confirmación** al convertir | P0 | ✅ hecho |
| COT-4 | **Registrar en el historial qué usuario convirtió** la cotización | P0 | ✅ hecho |
| COT-5 | **No permitir convertir dos veces** | P0 | ✅ hecho |
| COT-6 | Una vez convertida, la cotización **sale del listado activo** | P1 | ✅ hecho |
| COT-9 | **Vencimiento automático** al pasar `validUntil` | P1 | ✅ hecho |
| COT-7 | **Costeo interno tipo Cascada**, invisible en el PDF del cliente | P0 | pendiente |
| COT-8 | **Descuento especial** (% o monto), con registro de quién lo autorizó | P1 | pendiente |
| COT-10 | **Elegir empresa emisora** — ⚠️ ver P1 en el acta | ? | bloqueado |
| COT-11 | **Ítems jerárquicos** (1, 1.1, 1.2…) en vez de un único importe | P0 | pendiente |

## Cómo quedó implementado

| Req | Dónde |
|---|---|
| COT-1 | `nextQuoteNumber()` en `src/lib/models.ts`. Formato `COT-<n>`, con contador atómico. La primera vez arranca desde el número más alto ya cargado, para no pisar los que vienen del sistema anterior |
| COT-2 | `src/app/api/quotes/[id]/convert/route.ts` — devuelve 409 si el estado no es `aprobada`. Antes esa misma línea **aprobaba** la cotización |
| COT-3 | `convertQuote()` en `src/components/entity-manager.tsx` |
| COT-4 | Se escribe en `quote.history` con `userId` y `userName`, además de la auditoría |
| COT-5 y COT-6 | Estado nuevo `convertida` + campo `workId`. El botón ya estaba condicionado a `aprobada`, así que desaparece solo. El badge queda gris |
| COT-9 | `expireQuotes()` en `scripts/worker.mjs`, corre cada 5 minutos |

### Decisión tomada al implementar COT-9

Las cotizaciones **aprobadas no vencen**. Sólo vencen `borrador`, `enviada` y `seguimiento`.

Vencer una cotización ya aprobada dejaría la obra imposible de crear sin que nadie se entere —
y el estado `vencida` no se puede convertir. Si el cliente quiere que también venzan las aprobadas,
es cambiar un array, pero conviene preguntarlo antes.


## Notas de diseño

- El costo estimado debe salir de **la suma de productos, insumos y personal** que requiere la obra, no cargarse a mano.
- Los precios unitarios de materiales vienen del catálogo de [[stock]]; los de mano de obra, del valor de jornal en [[personal]].
- El PDF al cliente **nunca** muestra el desglose de costo ni el beneficio. Textual: *"no tiene que decir beneficio 35 % porque si no, no estamos quedando en el pie"*.
- Cuando la cotización se convierte en obra, **dispara aviso a compras y logística** con los materiales necesarios y la fecha de inicio.

## Riesgo abierto

El cliente anticipó el problema él mismo: cotizar con una empresa y facturar con otra por conveniencia de IVA.
*"Ya me estoy anticipando un problema que puede surgir."* Hay que definir si la empresa se fija en la cotización o en la factura antes de modelar esto.
