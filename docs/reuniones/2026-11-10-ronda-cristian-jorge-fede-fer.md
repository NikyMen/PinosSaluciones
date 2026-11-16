# Ronda de reuniones del 10/11/2026: Cristian, Jorge, Fede y Fer

- **Fecha:** 10/11/2026, en este orden: Cristian (mañana), Jorge, Fede y, a la tarde, Fer (1 h 48 min).
- **Fuente:** cuatro grabaciones transcriptas con Whisper large-v3-turbo y los apuntes en papel del día. La transcripción tiene ruido: los montos y nombres sueltos hay que confirmarlos.
- **Peso:** la de Fer es la principal, porque repasó compras, tesorería y ventas completos. Las de Jorge y Fede trajeron pocos cambios nuevos.

Estado de cada pedido: ✅ ya está en el sistema · ◐ está a medias · 🆕 falta hacerlo · ❓ hay que definirlo.

---

## 1. Cristian: ventas, facturación y cotizaciones

| # | Pedido | Estado |
|---|---|---|
| C1 | **Facturar desde Ventas** como en Tango: elegir el cliente o crearlo con un botón **Nuevo cliente**, elegir la empresa (Verticales o Constructora) y cargar ítems, sean **productos** del salón o **conceptos/servicios** (por ejemplo, "por m²") con precio unitario editable | ✅ 16/11 |
| C2 | Que esa factura tenga un campo de **descripción u observaciones** ("El trabajo comprende…") y se pueda **descargar en PDF** | ✅ 16/11 |
| C3 | **Venta con remito** para sacar insumos del salón hacia una obra: se elige la obra, Jorge firma el remito y baja el stock (sirve de control) | ✅ 16/11 |
| C4 | Cristian **aprueba** la cotización o la venta, y al aprobarla **les avisa a Jorge, Fede y Fer**. Ellos solo la consultan, no la aprueban. Recién ahí Fer puede facturar | ✅ 16/11, avisos por rol |
| C5 | En la cotización, cargar los **insumos** que va a necesitar la obra (tachos, rodillos, lija, sellador, fijador) **aunque no estén en stock**. Si falta algo, **se le avisa a Jorge** | ✅ 16/11 |
| C6 | Cargar los productos del **Salón de Ventas** desde el Excel que va a pasar Cristian | 🆕 falta el Excel |

## 2. Jorge: compras

| # | Pedido | Estado |
|---|---|---|
| J1 | IVA 0 % en la solicitud | ✅ |
| J2 | Que la compra pueda ir al **Galpón** o al **Salón de Ventas** y después repartirse a la obra o a los utilitarios | ✅ (`stockOnApproval`) |
| J3 | Que al lado del IVA se pueda indicar **"IVA ya incluido"**, porque el presupuesto del proveedor viene con precios finales y el sistema le sumó el IVA de nuevo | ✅ 16/11 |
| J4 | **Adjuntar el PDF** del presupuesto del proveedor a la solicitud o la OC | ❓ revisar si ya se puede |
| J5 | Jorge carga **todos los remitos** y no puede guardar ninguno sin asociarlo a una obra o cotización | ✅ 16/11 |

## 3. Fede: obras

| # | Pedido | Estado |
|---|---|---|
| F1 | Fechas de **inicio y fin, previstas y reales**, a la vista en el listado | ✅ |
| F2 | **Avance manual** sin hacer la inspección completa, con la fila en rojo cuando va atrasada | ✅ |
| F3 | Mostrar el **% escrito** sobre la barra de avance | 🆕 |
| F4 | Cargar la **duración en días** y que el sistema calcule el fin **sin contar sábados, domingos ni feriados nacionales**. Fede mencionó que algunos días cuentan medio (0,5) | 🆕 ❓ |
| F5 | En el listado: sacar "Notificar", achicar "Estado" y sumar la duración. Fede pidió **mantener el presupuesto**, aunque hoy está oculto | ❓ |
| F6 | **Foto** de la obra en la cotización | 🆕 |
| F7 | **Ubicación**: un link que abra Google Maps y un **mapa propio** con todas las obras (Corrientes, Chaco, interior) con su % de avance, que se pueda ver desde un link | 🆕 |
| F8 | Cuando se aprueba la cotización, a Fede le llega la obra para asignarle **fechas y personal** | ◐ |
| F9 | Más adelante: tomar como referencia su Excel "programa general" (un Gantt semanal, el avance general por obra y colores verde = en ejecución, amarillo, blanco = terminada) y sus planillas de personal y materiales por obra | idea a futuro |

## 4. Fer: tesorería, compras y ventas (la reunión principal)

### 4.1 Cómo se encadenan los documentos

Fer dejó clara una regla: **la factura es el documento central**.

```
Cotización = Obra ──► Orden de compra ──► FACTURA ◄── Orden de pago
                                            ▲
                                         Remito(s)
```

- La **cotización y la obra son lo mismo**. Donde diga obra, conviene mostrar "Cotización / Obra".
- Desde la factura se tiene que ver todo: la OC, la cotización, la OP y los remitos. Desde la OP solo se ve la factura que paga.
- El remito se asocia a la factura y a la OC, para controlar lo pedido contra lo recibido y lo facturado (faltantes, NC o ND).
- **El orden no siempre es el mismo.** Hay que poder asociar documentos en cualquier sentido:
  - **Factura sin OC**: Seba compra por su cuenta para arrancar una obra. La factura se carga y se paga, y la cotización y la OC se hacen después y se vinculan.
  - **OP sin factura**: se paga en octubre y la factura llega en noviembre (por el cierre de ARCA). Se emite la OP con el casillero de factura vacío y después se le asocia.
  - **Recibo sin factura**: un anticipo a cuenta, antes de que exista la cotización.

### 4.2 Compras: facturas recibidas

| # | Pedido | Estado |
|---|---|---|
| R1 | Dos formas de cargar: **Factura con remito** (materiales y bienes de uso, obligada a elegir remitos que ya cargó Jorge) y **Factura sin remito** (servicios: luz, agua, higiene y seguridad, servicios contratados) | ✅ 16/11 |
| R2 | En la factura con remito, que aparezcan **todos los remitos sin facturar**, incluso los de meses anteriores, para tildar varios. Después se listan sus artículos para ponerles precio | ✅ 16/11 |
| R3 | Factura cargada desde una OC: la **obra, el proveedor y los artículos vienen bloqueados** y solo se editan los **precios** (por diferencias de IVA) | ✅ 16/11 |
| R4 | **Asociar después** una factura sin OC a una OC o cotización (el "camino inverso") | ✅ 16/11 |
| R5 | Rubro o **categoría** de la obra (seis: en altura, albañilería, pintura interior, pintura exterior, impermeabilización, poliuretano…). Que sea **obligatorio para Cristian** en la cotización y llegue bloqueado a la compra. Gerencia puede ajustar la lista en Configuración | ✅ 16/11 |
| R6 | Número de comprobante: al elegir el tipo, la **letra se pone sola y no se puede editar** (A, C o X), y después van **12 dígitos obligatorios: 4 antes del guion y 8 después**. Si sobra o falta alguno, no deja guardar | ✅ 16/11 |
| R7 | Tipos **Factura / Nota de crédito / Nota de débito**. "Factura que corrige" aparece **solo en las notas**, con dos opciones: **con referencia**, que obliga a elegir la factura (y descuenta total o parcial), o **sin referencia**, que queda como crédito a favor | ✅ 16/11 |
| R8 | Poner la **fecha de emisión debajo del número** y la **fecha de vencimiento debajo del proveedor** | ✅ 16/11 |
| R9 | **Período** distinto de la fecha: por ejemplo, emitida el 2/11 pero del período octubre | ❓ revisar |
| R10 | Cargar el **neto** y que el **IVA (único dato en %) y el total se calculen solos**. Las percepciones y los otros impuestos van como **importe**, no como porcentaje, y todo se detalla abajo | ✅ 16/11 |
| R11 | Cambiar "Descripción" por **"Leyenda"** | ✅ 16/11 |
| R12 | **Sacar "Estado"** al cargar. Pagada o pendiente sale de la OP, y "anulada" no tiene sentido en una factura que recién se carga | ✅ 16/11 |
| R13 | **Edición:** si la factura **no tiene OP** se puede editar o borrar todo, incluida la fecha. Si **tiene OP**, solo se edita la leyenda; para cambiar el resto hay que anular la OP | ✅ 13/11 |
| R14 | El usuario de Fer o Ricci solo **ve las órdenes de compra** (no las gestiona), y Gerencia puede **editar el nombre de usuario** y ajustar los permisos existentes | ✅ 16/11 |

### 4.3 Órdenes de pago

| # | Pedido | Estado |
|---|---|---|
| P1 | Pasar el botón **Órdenes de pago** a **Compras** | ✅ 16/11 |
| P2 | Poder emitir una **OP sin factura** y asociarle la factura después. Se aplica editando la OP | ✅ 13/11 |
| P3 | Al elegir el proveedor, que aparezcan sus **facturas pendientes** para elegir cuáles pagar, total o en parte | ✅ |
| P4 | Sacar **"Tipo de gasto"**, que sale de la factura, y la **obra**, que sale de la OC o cotización | ✅ 16/11 |
| P5 | Sacar **"Pago"** y dejar solo la **fecha de pago con calendario**, para poder cargar pagos de días anteriores | ✅ 16/11 |
| P6 | Medios: **sacar e-Cheq** (por el número saben si es electrónico) y, al elegir **Cheque**, mostrar **solo las cuentas que emiten cheques** (de la 40 en adelante) | ✅ 16/11 |
| P7 | **Cheques de terceros con saldo**: si el cheque supera lo que se paga, la diferencia queda **a cuenta** y el cheque sigue en cartera con el saldo que le queda, con su historial. Esto vale solo para cheques de terceros | ✅ 13/11: el sobrante queda a cuenta en la OP |
| P8 | Campos editables (**N° de cheque**, "Con qué se paga") en blanco y con placeholder, para que se note que son para escribir | ✅ 16/11 |

### 4.4 Ventas: facturas emitidas, remitos y recibos

| # | Pedido | Estado |
|---|---|---|
| V1 | Igual que en compras: **Factura** (servicios y mano de obra) y **Factura con remito** (productos del salón). El remito de venta es el que **descuenta el stock**, y se elige al cargar la factura con remito | ✅ 16/11 |
| V2 | **Nota de crédito y nota de débito** con o sin referencia, como en compras | ◐ |
| V3 | **Sacar "Estado"**: la factura está pendiente mientras no tenga recibo | ✅ 16/11 (al cargar; al editar queda para anular) |
| V4 | **Recibo a cuenta** sin factura ni cotización, para anticipos (los arregla Seba). Después se le asocia la factura | ✅ 13/11 |
| V5 | Indicadores de **cuánto se facturó de cada cotización** (parcial o total) y de **cuánto se cobró de cada factura** | ✅ 16/11 |
| V6 | **Cargar a mano facturas emitidas viejas** (antes del sistema) | ✅ 13/11: opción "Cargar una ya emitida" |
| V7 | **PDF del recibo**: número, fecha de cobro, datos del cliente y factura asociada. Después, un renglón por medio con su caja o cuenta ("Transferencia Mercado Pago", "Banco de Corrientes"), los cheques con número y fecha de cobro, las retenciones y, abajo, **el total de lo aplicado más el pago a cuenta**. Lleva línea de firma con **nombre y cargo impresos**, configurables por empresa | ✅ 16/11 |

### 4.5 Contadores de facturas pendientes (en compras y en ventas)

| # | Pedido | Estado |
|---|---|---|
| T1 | Recuadros con **Facturas recibidas** (en compras) o **Facturas emitidas** (en ventas) y **Pendientes en rojo** | ✅ 16/11 |
| T2 | Al hacer clic en Pendientes, la **lista con el saldo de cada factura** y el total. La factura queda pendiente **hasta el último peso**, aunque la diferencia sea por un error de carga | ✅ 16/11 |

---

## 5. Plan de trabajo

Ordené las etapas así: primero lo que **frena la carga diaria** de Fer, que hoy tiene que crear facturas falsas para poder avanzar; después los arreglos chicos de formularios; y al final lo grande.

### Etapa 1: destrabar tesorería (P0) ✅ hecha el 13/11, ver `docs/decisiones/2026-11-tesoreria-a-cuenta.md`
1. **OP sin factura** y asociarle la factura después (P2).
2. **Cheque de terceros con saldo a cuenta** (P7).
3. **Cargar facturas emitidas viejas a mano** (V6).
4. **Recibo a cuenta** sin factura (V4).
5. **Editar o borrar una factura recibida mientras no tenga OP**; si tiene OP, solo la leyenda (R13).

### Etapa 2: limpiar formularios (P0, son chicos) ✅ hecha el 16/11, ver `docs/decisiones/2026-11-tesoreria-formularios.md`
6. Número de comprobante con letra fija y 4 + 8 dígitos (R6).
7. "Factura que corrige" solo en NC/ND, con o sin referencia (R7, V2).
8. Sacar Estado de las facturas recibidas y emitidas (R12, V3).
9. Neto que calcula el IVA, percepciones como importe y detalle abajo (R10).
10. "Descripción" pasa a "Leyenda", y las fechas de emisión y vencimiento van debajo del número y del proveedor (R11, R8).
11. OP: sacar Tipo de gasto y Pago, dejar la fecha con calendario y mover el botón a Compras (P1, P4, P5).
12. Medio Cheque: sin e-Cheq y solo cuentas de la 40 en adelante; placeholders (P6, P8).
13. "IVA ya incluido" en la solicitud de compra (J3).

### Etapa 3: remitos y vínculos entre documentos (P1)
14. Factura **con remito** y **sin remito**, en compras y en ventas (R1, V1).
15. Elegir varios remitos pendientes y ponerles precio a sus artículos (R2), y controlar lo pedido contra lo recibido.
16. Factura desde OC con obra y artículos bloqueados y precios editables (R3).
17. Asociar en cualquier sentido: factura ↔ OC/cotización, OP ↔ factura, remito ↔ factura (R4).
18. Desde la factura, ver la OC, la cotización, la OP y los remitos.
19. Rubro obligatorio en la cotización, que llegue bloqueado a la compra (R5).

### Etapa 4: indicadores y documentos (P1)
20. Contadores de recibidas, emitidas y pendientes, con la lista y los saldos (T1, T2).
21. Facturado y cobrado por cotización y por factura (V5).
22. Nuevo PDF del recibo con los medios, el total y la firma de tesorería (V7).
23. Permisos y nombre de usuario de Fer y Ricci (R14).

### Etapa 5: ventas del salón y cotización operativa (P1)
24. Facturar desde Ventas con productos y conceptos, Nuevo cliente, descripción y PDF (C1, C2).
25. Remito de venta hacia una obra, firmado por Jorge (C3).
26. Al aprobar la cotización, avisarles a Jorge, Fede y Fer (C4, F8).
27. Insumos en la cotización aunque no haya stock, con aviso a Jorge (C5).
28. Importar los productos del salón desde el Excel de Cristian (C6).

### Etapa 6: obras (P2)
29. % escrito en la barra (F3).
30. Duración en días hábiles con feriados (F4).
31. Foto, link a Google Maps y mapa de obras con avance (F6, F7).
32. Ajustar las columnas del listado (F5).

---

## 6. Preguntas abiertas

> **Respondidas el 16/11/2026.** Las decisiones y el plan detallado de las etapas 3 a 6 están en `docs/plan-etapas-3-a-6.md`. Quedan pendientes el Excel del salón (Cristian) y la lista definitiva de rubros (Fer).

1. **Presupuesto en el listado de obras:** Fede pidió mantenerlo, pero se sacó en el último cambio (`9118229`). ¿Vuelve a mostrarse? ¿Solo para algunos roles?
2. **Duración en días:** ¿el sábado cuenta medio día? ¿Qué feriados se toman (nacionales, provinciales de Corrientes)?
3. **Rubros:** confirmar los seis exactos y si se suman a los de la cotización que ya existen.
4. **Mapa de obras:** ¿tiene que ser un link público o con acceso solo para usuarios? ¿Quién carga la ubicación: Cristian en la cotización o Fede en la obra?
5. **Cheque de terceros con saldo:** ¿el sobrante queda como crédito del proveedor ("a cuenta") o el cheque sigue en cartera para otra OP? Según la grabación, se piden las dos cosas.
6. **Firma digital del recibo:** ¿es una imagen de la firma o solo el nombre y el cargo impresos?
7. **Excel del salón de ventas:** queda pendiente que lo mande Cristian.
