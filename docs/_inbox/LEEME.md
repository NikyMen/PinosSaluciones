# Inbox — material crudo

Tirá acá todo tal cual está, sin ordenar ni renombrar:

- La transcripción de la reunión (`.txt`, `.md`, `.docx`)
- El resumen y los puntos clave que generó la IA
- Los Excels modelo del cliente (`.xlsx`, `.csv`)
- Los comprobantes de ejemplo (`.pdf`, fotos, escaneos)
- Cualquier foto de pizarrón, captura o nota suelta
## RESUMEN Primera Reunion : 
La reunión se centró en la planificación del desarrollo de un nuevo sistema de gestión para unificar operaciones, mejorar la trazabilidad y automatizar procesos clave como la liquidación de jornales, la gestión de cotizaciones y obras, el control de stock y el mantenimiento de bienes de uso.  
###  *Tema:* 
Desarrollo e implementación de un sistema de gestión integral para obras, cotizaciones, personal, stock y logística.  

 *Puntos clave:*
-  La clave del sistema es la trazabilidad y unificación de todas las operaciones, que actualmente es una debilidad.
- Se requiere un módulo de stock para materiales e insumos, que incluya cantidad, costo y alertas de mínimo.
- Es fundamental automatizar la liquidación de jornales basándose en las horas trabajadas por persona en cada obra, con opciones de visualización, exportación y filtrado por fechas.
- El sistema debe generar certificados y facturas automáticamente, con notificaciones a administración, y permitir la selección de la empresa emisora (Pino SRL o Trabajos Verticales Pino SAS).
- Las cotizaciones deben pasar por un estado 'aprobado' antes de convertirse en obra, con un doble check de confirmación y registro del usuario que realiza la conversión.
- Las cotizaciones deben incorporar costos internos (materiales, mano de obra, equipos, gastos fijos, gastos generales indirectos, beneficio) para análisis interno, sin ser visibles para el cliente.
- Se necesita un módulo de bienes de uso para el mantenimiento preventivo de vehículos y equipos (andamios, silletas, elementos de seguridad), registrando datos como kilometraje y servicios.
- Se debe implementar un módulo de logística para la asignación de tareas diarias, rutas de entrega y generación de remitos digitales con firma y foto del encargado en obra.
- La prioridad de desarrollo es: Obras y Cotizaciones, seguido de Stock, luego Administración y, finalmente, el Dashboard. 

 
 ==📅 *Fechas:* 25 del 8; Primero de septiembre; Julio; Mayo; Todos los jueves a las tres de la tarde==  
*Acciones:*  
🔵 Liberar a Fernando y Cristian de la reunión actual.  

🔴 Preparar anticipo en efectivo para Fernando.
🔴 Solicitar a Juanpe el formulario de Excel de ejemplo para liquidación de jornales.  
🔴 Solicitar a Fede un modelo de certificado de obra.  
🔴 Solicitar el Excel de recursos e insumos para cotización (Cascada/Cupano).  

🟡 Definir la mecánica de trabajo para el desarrollo del sistema (estructura base y luego detalles con cabezas de sector).  
🟡 Desarrollar un módulo de stock dentro de compras para materiales e insumos, incluyendo cantidad y costo.  
🟡 Incorporar el campo 'teléfono' en el registro de personal asignado a obras.  
🟡 Crear un módulo central de 'personal' para cargar todos los datos de los empleados.  
🟡 Automatizar la liquidación de jornales basada en horas trabajadas por persona en cada obra, con visualización, exportación y filtrado por fechas.  
🟡 Implementar notificaciones a administración para la generación de certificados y facturas cuando una obra alcance un avance definido (ej. 50%).  
🟡 Desarrollar la funcionalidad de conversión de cotización a obra, requiriendo estado 'aprobado', con pop-up de confirmación y registro del usuario.  
🟡 Configurar la generación automática del número de cotización.  
🟡 Permitir la selección de la empresa (Pino SRL o Trabajos Verticales Pino SAS) al crear una cotización.  
🟡 Integrar los costos internos (materiales, mano de obra, gastos, beneficio) en las cotizaciones para uso interno.  
🟡 Implementar alertas de stock mínimo para materiales e insumos.  
🟡 Crear un apartado de 'bienes de uso' para vehículos y equipos, registrando kilómetros, servicios, etc., para mantenimiento preventivo.  
🟡 Reestructurar el módulo de administración para incluir facturación, cobranzas, pagos, cheques, caja de bancos y personal, y gastos generales.  
🟡 Desarrollar un sistema de logística para asignar tareas diarias, rutas de entrega y generar remitos con firma y foto.  
🟡 Priorizar el desarrollo de los módulos de Obras y Cotizaciones en el próximo encuentro.  
🟡 Agendar la próxima reunión con los 'chicos de cotizaciones'.  
🟡 Asegurar que el costo estimado de la obra en la cotización se derive de la suma de productos, insumos y personal.  
🟡 Implementar un campo de 'descuento especial' en las cotizaciones.  
🟡 Automatizar el estado 'vencida' para cotizaciones pasadas de la fecha de validez.  
🟡 Asegurar que el stock de materiales se pueda asignar a obras y se compute como costo.  
🟡 Implementar un sistema de 'venta rápida' para productos de stock.  
🟡 Asegurar que cada obra tenga una ubicación asignada.




Sugerencia de nombres, pero no es obligatorio:

```
2026-08-21-reunion-transcripcion.txt
2026-08-XX-reunion-resumen-ia.md
excel-clientes.xlsx
comprobante-factura-a.pdf
```

## Importante

Esta carpeta está en `.gitignore` **a propósito**: acá hay CUITs, nombres, importes y
datos de terceros reales. No se commitea y no se publica en ningún lado.

Lo que sí se versiona es lo que se destila desde acá hacia `reuniones/`,
`requerimientos/` y `modelo-datos/`.


![[PINTURA EN ALTURA ok.xlsx]]

![[PINTURA INTERIOR ok.xlsx]]

![[POLIUREA 9 de julio 1699 resis.xlsx]]

![[POLIURETANO ok.xlsx]]

![[REVOQUE EXTERIOR MAT Y MO ok.xlsx]]

![[UNIDAD POLIUREA CALIENTE.pdf]]