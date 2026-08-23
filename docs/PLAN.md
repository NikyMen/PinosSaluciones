# Plan de trabajo post-reunión

Objetivo: convertir la reunión + los archivos modelo del cliente en cambios concretos
en la app, sin construir nada que nadie pidió.

**Estado: fases 0 a 3 completas. Falta priorizar (fase 4) para empezar a codear.**

---

## ✅ Fase 0 — Intake

Material recibido en `_inbox/`:

| Archivo | Qué aportó |
|---|---|
| `transcripcionDeLaReunion.txt` | 65 KB de relevamiento |
| `Resumen e ideas de una ia…txt` | Resumen automático — coincide con la transcripción, sin contradicciones |
| 7 × `*.xlsx` (revoque, pintura, poliurea, poliuretano, impermeabilización) | El cotizador "Cascada" |
| `PLANILLA_SUELDO_QUINCENAL_2026.xlsm` | Liquidación quincenal completa, 27 hojas |
| `(certificadoDeObra)747…pdf` | Certificado de avance real |
| `UNIDAD POLIUREA CALIENTE.pdf` | Cotización al cliente (salida de Tango) |

⏳ Sigue pendiente: registro de **bienes de uso**, planilla de **mantenimiento**, modelo de **factura**.

---

## ✅ Fase 1 — Destilar la reunión

→ [[reuniones/2026-08-relevamiento-inicial]]

Las cuatro listas quedaron separadas: 18 pedidos explícitos, 8 decisiones, 6 preguntas abiertas
y 5 ideas sueltas que **no** son requerimientos.

Backlog por módulo en [[requerimientos/00-backlog]].

---

## ✅ Fase 2 — Autopsia de los archivos modelo

| Documento | Qué decodifica |
|---|---|
| [[modelo-datos/cotizador-cascada]] | Los 9 niveles de la cascada, con porcentajes y conceptos |
| [[modelo-datos/liquidacion-quincenal]] | Padrón, parte diario, tarifas, deducciones, resúmenes |
| [[modelo-datos/certificado-obra]] | Avance por ítem, anticipo financiero, índice CAC |
| [[modelo-datos/cotizacion-pdf]] | Lo que sí ve el cliente |

---

## ✅ Fase 3 — Gap analysis

→ [[gap-analysis]]

11 cosas ya funcionan · 15 están a medias · 9 módulos hay que construirlos.

Tres hallazgos que cambian el plan:

1. **El certificado no es un botón** — certifica ítem por ítem, con arrastre de acumulado y descuento de anticipo
2. **La cotización es la pieza estructural** — hoy es un registro plano con un importe
3. **La conversión hace lo contrario de lo pedido** — hoy *aprueba* la cotización en vez de *exigir* que esté aprobada

---

## ✅ Fase 4 — Priorizar

El cliente dio el orden macro: **Cotizaciones y Obras → Stock → Administración → Dashboard**.

Decisiones tomadas sobre eso:

- **Arrancar por los quick wins de cotización** (COT-1 a COT-6 + COT-9), para llegar a la reunión con el equipo de cotizaciones con el flujo arreglado
- **El certificado se modela completo**, por ítem → [[decisiones/2026-08-certificado-por-item]]

---

## 🔄 Fase 5 — Ejecutar ← acá estamos

### Hecho

Los 7 quick wins de [[requerimientos/cotizaciones]] están implementados y verificados
(`pnpm lint`, `pnpm test` con 13 tests, `pnpm build`).

El más importante: la conversión **exigía** lo contrario de lo pedido. Ahora valida en vez de asignar.

### Lo que sigue

Por dependencia, no por preferencia:

1. **COT-11 — ítems jerárquicos en la cotización.** Desbloquea todo lo demás
2. **COT-7 — el costeo Cascada** sobre esos ítems
3. **OBR-3 — certificados por ítem**, que dependen de 1 y 2

### Convención

Una rama por cambio, con el ID de requerimiento en el commit (`COT-11`, `OBR-3`…).
Comandos de calidad: `pnpm lint`, `pnpm test`, `pnpm build`.

---

## Antes de la próxima reunión

Conviene llevar resueltas las 6 preguntas abiertas del acta. Las dos que más impactan:

- **P1** — ¿la empresa emisora se elige en la cotización o en la factura? El cliente ya anticipó el conflicto de IVA
- **P2** — ¿el certificado es global o por ítem? Definir con Fede
