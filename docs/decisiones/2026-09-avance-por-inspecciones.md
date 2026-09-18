# El avance físico de la obra sale de las inspecciones

- **Fecha:** 2026-09-18
- **Estado:** aceptada
- **Afecta a:** [[../requerimientos/obras]], [[../modelo-datos/esquema-actual]], [[2026-08-certificado-por-item]]

## Decisión

El avance de obra deja de cargarse a mano. Lo calcula el sistema a partir de las **inspecciones
diarias**, armadas sobre las cinco planillas de *PLANILLA DE INSPECCION DE OBRAS.xlsx*
(albañilería, impermeabilización, espuma de poliuretano, pintura y trabajos en altura).

- Cada obra tiene una **base de avance**: por rubro (o ítem) la cantidad prevista, lo ya ejecutado
  antes de usar inspecciones y el importe contratado. Se puede traer de la cotización.
- Por línea: producción acumulada / producción prevista (tope 100 %).
- General: promedio ponderado por importe contratado. Si falta algún importe, las líneas pesan igual.
- Cerrar una inspección recalcula `Work.progress`. Sin base de avance la obra muestra
  **"Sin base de avance"**: no se inventa un porcentaje.
- El consumo de materiales es un **indicador de desvío**: nunca mueve el avance.
- Los certificados siguen independientes: el avance económico puede no coincidir con el físico.

## Fuente de cada dato

| Dato | Fuente |
| --- | --- |
| Nombre, cliente, fechas, presupuesto, estado | Obra |
| Personas y horas | Partes diarios de la obra |
| Producción y avance físico | Inspecciones cerradas |
| Materiales que entran | Egresos de stock hacia la obra |
| Consumo y faltantes | Inspección (faltantes avisan a Compras) |
| Avance económico y facturación | Certificados |
| Tareas generales | Checklist de la obra |
| Calidad y seguridad del día | Inspecciones |

## Consecuencias

- Colección nueva `WorkInspection`, una por obra, rubro y día (índice único). Los puntos de control se
  copian de la plantilla al crearla: cambiar la plantilla no reescribe el pasado.
- La inspección cerrada no se edita. Un borrador se puede descartar.
- Los avances manuales (`Work.advances`) quedan como registro anterior, visibles en la obra.
- Migración: `pnpm migrate:progress` marca las obras con avance manual (`progressMode: "manual"`),
  que conservan su número hasta que se les cargue la base. Al cargarla, "Ya ejecutado" evita que
  vuelvan a cero.

## Queda abierto

- Integrar los faltantes con Compras (hoy solo avisan) y el consumo con Stock (hoy no descuenta).
- Si una inspección se cierra con fecha anterior a otra ya cerrada, el avance de la obra queda bien,
  pero los acumulados "hasta ayer" guardados en las posteriores no se reescriben.
- Reabrir una inspección cerrada (por ejemplo, solo Gerencia) no está implementado.
