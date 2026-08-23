# Gap analysis

Cruce entre lo relevado en [[reuniones/2026-08-relevamiento-inicial]] + los modelos reales de `modelo-datos/`
contra lo que la app hace hoy.

Verificado leyendo el código, no estimado.

---

## 🟢 Ya está — funciona y el cliente lo aprobó

| Qué | Dónde |
|---|---|
| Cotización → obra con botón de conversión | `src/app/api/quotes/[id]/convert/route.ts` |
| Guarda contra doble conversión **a nivel API** (409) | mismo archivo |
| Auditoría de la conversión | `audit(session, "convert_to_work", …)` |
| Checklist de tareas en obra | `WorkSchema.checklist` |
| Historial de actividad con fotos en obra | `WorkActivitySchema` |
| Historial de cambios en tareas | visible en la demo |
| Avance porcentual de obra | `WorkSchema.progress` |
| Campo `history` en cotizaciones | `QuoteSchema.history` — existe pero no se usa en la conversión |
| Módulos de cobranzas, pagos, cheques, caja | `entityConfig` |
| Permisos por rol | `src/lib/permissions.ts` |
| Adjuntar comprobantes | `type: "file"` en varios módulos |

---

## 🟡 Está a medias — el módulo existe, le falta

| # | Qué falta | Req | Dónde |
|---|---|---|---|
| 1 | **La conversión FUERZA `status = "aprobada"` en vez de exigirla.** Es exactamente lo contrario a lo pedido | COT-2 | `convert/route.ts:18` |
| 2 | El botón de convertir **sigue visible** en la UI después de crear la obra. El cliente lo notó en la demo | COT-5 | `entity-manager.tsx` |
| 3 | No hay **pop-up de confirmación** al convertir | COT-3 | UI |
| 4 | La conversión **no escribe en `quote.history`** — el dato está en auditoría, pero no se ve en la cotización | COT-4 | `convert/route.ts` |
| 5 | `number` de cotización es **obligatorio y manual** | COT-1 | `entity-config.ts` |
| 6 | `validUntil` existe pero **no vence nada**. El estado `vencida` hay que ponerlo a mano | COT-9 | `worker.mjs` |
| 7 | La cotización tiene **un solo `amountCents`** — no admite ítems jerárquicos | COT-11 | `QuoteSchema` |
| 8 | `estimatedCostCents` es **un número suelto**, sin composición ni cascada | COT-7 | `QuoteSchema` |
| 9 | No hay **descuento** de ningún tipo | COT-8 | `QuoteSchema` |
| 10 | Obras **no tiene ubicación** | OBR-6 | `WorkSchema` |
| 11 | Obras **no tiene personal asignado** | OBR-1 | `WorkSchema` |
| 12 | `invoices` no tiene **tipo de comprobante, punto de venta, neto, IVA ni retenciones** | ADM-4 | `entity-config.ts` |
| 13 | `clients` no tiene **CUIT ni condición frente al IVA** — aparecen en todos los comprobantes reales | — | `entity-config.ts` |
| 14 | El menú dice **"Finanzas"**, y no agrupa personal | ADM-1/2 | `constants.ts` |
| 15 | La importación exige **encabezados técnicos en inglés** y relaciones por ObjectId | — | `import/[entity]/route.ts` |

---

## 🔴 No está — hay que construirlo

| Módulo | Alcance | Prio cliente |
|---|---|---|
| **Cotizador / Cascada** | Ítems jerárquicos, composición por insumo, coeficientes, 9 niveles de cascada hasta el precio final | 1 |
| **Certificados de obra** | Numeración por obra, avance por ítem con anterior/período/acumulado, descuento de anticipo, PDF | 1 |
| **Notificaciones** | Campanita in-app, dirigidas por rol | 1 |
| **Personal** | Legajo, valor de jornal, categorías | 2 |
| **Horas y liquidación** | Parte diario por persona/día/obra, deducciones, liquidación quincenal exportable | 2 |
| **Stock** | Catálogo de productos, ingreso por compra, egreso por remito, valorización, mínimos | 2 |
| **Logística** | Tareas del día, ruta, remito con firma | 3 |
| **Bienes de uso** | Vehículos, equipamiento, mantenimiento preventivo | 3 |
| **Venta mostrador** | Egreso de stock a venta directa | 4 |

---

## Los tres hallazgos que cambian el plan

### 1. El certificado no es un botón

Se relevó como *"botón que genera el certificado por el 50 % de la obra"*. El modelo real ([[modelo-datos/certificado-obra]]) certifica **ítem por ítem**, con avance anterior / del período / acumulado, descuento proporcional del anticipo y redeterminación por índice CAC. El ejemplo es el **certificado número 20** de una sola obra.

Un `progress` global en la obra no alcanza para emitirlo. **Es el ítem más subestimado del relevamiento.**

### 2. La cotización es la pieza estructural

Todo cuelga de ahí: el costo, el certificado, el aviso a compras, la factura, el margen. Y hoy la cotización es un registro plano con un importe.

El cliente lo dijo sin vueltas: *"de la cotización parte nuestro costo"*. Rehacer cotizaciones con ítems y composición es el trabajo que desbloquea todo lo demás.

### 3. La conversión hace lo contrario de lo pedido

```ts
quote.status = "aprobada"; await quote.save();
```

Hoy convertir **aprueba** la cotización automáticamente. Lo pedido es que **no deje convertir** si no está aprobada — precisamente para forzar a que alguien se tome el trabajo de aprobarla.

Es una línea de código y es la primera que tocaría: cambia una asignación por una validación.

---

## Lo que la importación va a romper

Los Excels reales usan encabezados como `Apellido y Nombre`, `Categoría`, `Importe`, `Obra`.
La importación actual espera `name`, `amountCents`, `workId` y relaciones por ObjectId.

**Ninguna de las 8 planillas del cliente se puede importar hoy.** Hace falta un mapeo de columnas con alias en castellano y resolución de relaciones por nombre.
