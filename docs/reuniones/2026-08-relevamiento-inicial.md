# Reunión de relevamiento inicial

- **Fecha:** agosto 2026 *(confirmar día exacto)*
- **Fuente:** `_inbox/transcripcionDeLaReunion.txt` + resumen automático
- **Formato:** demo de la app actual + relevamiento módulo por módulo
- **Participantes (según transcripción, roles a confirmar):**
  - Coordinador general del proyecto, del lado del cliente — conduce la reunión
  - **Cristian** — ventas / cotizaciones. Es quien maneja el "Cascada"
  - **Fede** — obras. Define cuándo se emite un certificado
  - **Pablo** — compras y logística
  - **Juan Pablo / "Juanpe"** — envía el Excel de liquidación de jornales
  - **Fernando** — administración (anticipo)
  - **Seba / CEO** — autoriza descuentos especiales
  - Equipo de desarrollo

> Los nombres salen de una transcripción automática con bastante ruido. Verificar antes de usarlos en cualquier comunicación.

---

## 1. Pedidos explícitos del cliente

Lo que efectivamente se pidió. Detalle completo en [[../requerimientos/00-backlog]].

| # | Pedido | Módulo |
|---|---|---|
| 1 | Trazabilidad de punta a punta de cada obra: qué se compró, quién trabajó, cuándo se pagó, cuándo se cobró | transversal |
| 2 | Módulo de **stock** de materiales e insumos, con cantidad, costo y alerta de mínimo | [[../requerimientos/stock]] |
| 3 | Módulo de **personal** (legajo) con nombre, DNI, teléfono y **valor del jornal** | [[../requerimientos/personal]] |
| 4 | Carga de **horas por persona, por día, por obra** → liquidación quincenal exportable y filtrable | [[../requerimientos/personal]] |
| 5 | **Certificado de obra**: botón que genera PDF y notifica a administración | [[../requerimientos/obras]] |
| 6 | **Notificaciones** in-app (campanita) dirigidas por rol | [[../requerimientos/obras]] |
| 7 | Cotización → obra sólo con estado **aprobada**, con pop-up de confirmación y registro de quién convirtió | [[../requerimientos/cotizaciones]] |
| 8 | **Número de cotización automático** | [[../requerimientos/cotizaciones]] |
| 9 | **Costeo interno** (el "Cascada") dentro de la cotización, invisible para el cliente | [[../requerimientos/cotizaciones]] |
| 10 | **Descuento especial** con registro de quién lo autorizó | [[../requerimientos/cotizaciones]] |
| 11 | **Vencimiento automático** de cotizaciones al pasar "válido hasta" | [[../requerimientos/cotizaciones]] |
| 12 | Elegir **empresa emisora** (Constructora SRL / Trabajos Verticales SAS) | [[../requerimientos/cotizaciones]] |
| 13 | Módulo de **bienes de uso**: vehículos, andamios, silletas, EPP, con mantenimiento preventivo | [[../requerimientos/bienes-de-uso]] |
| 14 | Módulo de **logística**: tareas del día, ruta de entrega y **remito** con firma y foto | [[../requerimientos/logistica]] |
| 15 | Reorganizar el menú: "Finanzas" pasa a ser **Administración** e incorpora Personal | [[../requerimientos/administracion]] |
| 16 | **Ubicación** en cada obra | [[../requerimientos/obras]] |
| 17 | **Venta rápida / mostrador** de productos del stock (B2C y ferreterías) | [[../requerimientos/stock]] |
| 18 | Historial de cambios visible en obra (ya existe en tareas) | [[../requerimientos/obras]] |

---

## 2. Decisiones tomadas

| Decisión | Detalle |
|---|---|
| **Orden de desarrollo** | 1) Obras y Cotizaciones · 2) Stock y Compras · 3) Administración · 4) Dashboard. Textual: *"de la cotización parte nuestro costo"* |
| **Dashboard se posterga** | Se saca del alcance inmediato por pedido del cliente |
| **Factura ARCA: manual primero** | Se arranca con carga manual y se automatiza después. *"Que de última un día no funciona, que sepan cómo se hace manual"* |
| **El stock NO se debita automático** | Se descuenta cuando el material sale a la obra, contra remito |
| **Simplicidad por sobre features** | *"No quiero tampoco que haya muchos botones"* — los usuarios finales tienen poca alfabetización digital |
| **Metodología** | Estructura base con el coordinador, después detalle fino con cada cabeza de sector |
| **Próxima reunión** | Con el equipo de cotizaciones (Cristian) |
| **Reemplaza a Tango** | El sistema actual de stock se abandona; no se renovó la licencia |

---

## 3. Preguntas abiertas

Hay que resolverlas antes o durante la próxima reunión.

| # | Pregunta | Por qué bloquea |
|---|---|---|
| P1 | **¿Una cotización o dos?** Quedó sin cerrar si se cotiza como "Pino Soluciones Técnicas" y se elige la empresa recién al facturar, o si se elige desde el arranque | Cambia el modelo de datos de cotización y factura. El cliente planteó el problema del IVA: *"estamos re mal de IVA en verticales, tenemos que facturar con verticales"* |
| P2 | **¿El certificado es global o por ítem?** En la reunión se habló de "certificado por el 50% de la obra", pero el modelo real certifica **ítem por ítem** con avance anterior / presente / acumulado | Es la diferencia entre un campo y una tabla completa. Ver [[../modelo-datos/certificado-obra]] |
| P3 | **¿Se aplica redeterminación por índice CAC?** El certificado modelo la tiene | Si va, hay que modelar índices y meses base |
| P4 | **¿Cómo se identifica al personal?** Por DNI, por nombre o por código de legajo. Quedó explícitamente sin definir | Es la clave primaria del módulo personal |
| P5 | **¿Qué son exactamente los "insumos"?** El cliente dijo que después define la categorización (andamios, silletas, cuerdas, EPP) | Define la taxonomía de stock vs bienes de uso |
| P6 | **¿Las tarifas de la liquidación son siempre por hora?** En el Excel conviven tarifas horarias (~5.400) con tarifas por trabajo (POLIUREA 1 = 113.560) | Cambia el cálculo de la liquidación |

---

## 4. Ideas sugeridas — NO son requerimientos

Se mencionaron al pasar. Ninguna fue pedida en firme. **No construir sin confirmar.**

- GPS en los vehículos (*"lo vemos más adelante"*)
- Carga de horas desde el celular por el encargado en obra — descartado por ahora: *"los encargados son muy rústicos"*. Horizonte declarado: un año
- Agentes de IA sobre el sistema — conversación tangencial, sin pedido concreto
- Foto además de firma en el remito — surgió de una anécdota, se aceptó de palabra pero sin definir
- Valorización de amortización de maquinaria dentro del costo de obra — mencionado como interés (*"a mí me interesaría"*), sin definición

---

## 5. Material que el cliente se comprometió a enviar

| Material | Estado |
|---|---|
| Excel de recursos e insumos para cotizar ("Cascada") | ✅ Recibido (7 archivos) |
| Excel de liquidación de jornales | ✅ Recibido |
| Certificado de obra de ejemplo | ✅ Recibido |
| Cotización PDF de ejemplo (Tango) | ✅ Recibido |
| **Registro de bienes de uso** | ⏳ **Pendiente** — el cliente lo está armando |
| **Planilla de tareas de mantenimiento** (seguridad e higiene) | ⏳ **Pendiente** |
| Modelo de factura | ⏳ **Pendiente** |

---

Ver [[../gap-analysis]] para el cruce contra lo que la app ya hace.
