# Obras

Módulo existente (`works`). **Prioridad 1** junto con [[cotizaciones]].

Modelo de referencia: [[../modelo-datos/certificado-obra]]

| ID | Requerimiento | Prio |
|---|---|---|
| OBR-1 | **Personal asignado**, traído de [[personal]] con nombre, apellido, DNI y teléfono, con autocompletado | P0 |
| OBR-2 | **Carga de horas por persona y por día** dentro de la obra | P0 |
| OBR-3 | **Certificado de obra**: generar comprobante + PDF | P0 |
| OBR-4 | El certificado **dispara notificación a administración** para que emita la factura | P0 |
| OBR-5 | **Campanita de notificaciones** in-app, dirigidas por rol | P0 |
| OBR-6 | **Ubicación** de la obra — necesaria para la ruta de [[logistica]] | P1 |
| OBR-7 | **Historial de cambios** visible en la obra (ya existe en tareas) | P1 |
| OBR-8 | **Consumo de materiales** desde [[stock]], computado como costo de la obra | P1 |

## Lo que ya funciona

Confirmado en la demo, el cliente lo aprobó: checklist de tareas, carga de imágenes, historial de cambios en tareas, avance porcentual, conversión desde cotización.

> *"A mí me gustó todo, sinceramente, muy bueno."*

## El punto crítico: cómo se certifica

En la reunión se habló de *"botón de generar certificado por el 50 % de obra"*. El certificado modelo **no funciona así**: certifica ítem por ítem, con avance anterior, del período y acumulado, más descuento de anticipo y redeterminación por índice CAC.

Antes de implementar OBR-3 hay que definir con Fede cuál de los dos es el alcance. Ver [[../modelo-datos/certificado-obra]].

## Flujo de cobro declarado

1. Anticipo del 30–50 % a la aprobación
2. Certificados por avance durante la ejecución
3. Cada certificado descuenta la parte proporcional del anticipo
