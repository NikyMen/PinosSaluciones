# Especificación funcional v1.5 — qué está hecho y qué falta

Fuente: *Especificación funcional — Sistema integral de gestión* (administración PINO, v1.5,
3/10/2026, "modelo multi-CUIT y logística de depósitos corregidos"), más el pedido por chat del
2/10: la barra lateral con los trece módulos y la **Factura X** para compra y venta.

El PDF original no va al repo (es documento interno). Acá queda destilado, punto por punto,
contra lo que hace el sistema. Las decisiones de diseño están en
[[../decisiones/2026-10-multi-cuit-depositos-comprobantes]].

Leyenda: ✅ hecho · 🟡 parcial · ⏳ pendiente (o esperando una decisión del punto 16).

---

## Pedido por chat

| Pedido | Estado | Dónde |
|---|---|---|
| Barra azul con Configuración, Seguridad, Maestros, Comercial, Obras, Compras, Ventas, Stock y logística, Personal, Activos, Tesorería, Contabilidad y Gestión | ✅ | `src/components/app-shell.tsx` |
| Factura X ("en negro") en venta y en compra | ✅ | Ver punto 9 |

## 1. Modelo multi-CUIT

| Requisito | Estado | Cómo |
|---|---|---|
| Cualquiera de los dos CUIT compra y cualquiera factura, sin relación fija | ✅ | La orden de compra lleva su empresa; la factura, la suya; nada las ata |
| CUIT comprador | ✅ | `Purchase.company`, `Expense.company` |
| CUIT propietario de cada existencia | ✅ | `StockItem.owners` por ubicación (`src/lib/stock-owners.ts`). Lo que entra es de la empresa que compró |
| CUIT consumidor | 🟡 | La salida a obra consume primero lo de la empresa de la obra; un centro de costo propio por CUIT no existe todavía |
| CUIT facturante | ✅ | `Invoice.company`, `SalesRemito.company`, `Quote.company` |
| Ubicación física (Central, Salón, tránsito, obra) | ✅ | Niveles por depósito, `transitQty` y la salida a obra |
| Destino económico | 🟡 | Obra (salida a obra) y venta (remito); reposición y mantenimiento no tienen tipo propio |

## 2. Depósitos y flujo físico

| Requisito | Estado | Cómo |
|---|---|---|
| Toda compra entra al Depósito Central | ✅ | La entrada manual de stock y la caja rechazan cualquier otro depósito; "Pasar a stock" de una OC pedida para el Salón de Ventas entra directo al Salón |
| Central → Salón con estado "en tránsito" | ✅ | `src/lib/stock-transfers.ts`; pantalla Stock y logística › Transferencias |
| Recepción confirmada en el Salón, con diferencias documentadas | ✅ | Por renglón: llegó bien, dañado (pasa a "no utilizable") y faltante |
| La transferencia no es venta ni factura | ✅ | No toca plata ni costo |
| El remito al cliente se origina en el Salón | ✅ | Ventas › Remitos de venta; solo descuenta del Salón |
| Obra: remito, recepción, consumo, sobrante, devolución, pérdida | 🟡 | Remito de salida a obra y consumo por inspección; la devolución de obra al depósito se hace hoy con un ajuste |

## 3. Modelo de stock

| Requisito | Estado | Cómo |
|---|---|---|
| Catálogo único, saldo no indiferenciado (CUIT, ubicación, estado, costo) | ✅ | Por depósito y por dueño; costo promedio por material |
| Físico, disponible, reservado, en tránsito, no utilizable | ✅ | Columnas del stock y del modal de cada material |
| Comprometido (pendiente de despacho) | ⏳ | Hoy lo comprometido se ve como reservado |
| Todo cambio es un movimiento | ✅ | Ya era así |
| Sin stock físico negativo | ✅ | Ninguna salida, transferencia ni venta deja negativo |
| La factura referencia el remito y no descuenta | ✅ | `Invoice.remitoIds`; la factura no toca el stock |

## 4. Cotización, stock y estados

| Requisito | Estado | Cómo |
|---|---|---|
| Estados de cotización: en elaboración, emitida, aprobada | ✅ | Nombres nuevos sobre las claves de siempre (`borrador`, `enviada`, `aprobada`) |
| Estados de obra: pendiente de inicio, activa, finalizada, cerrada | ✅ | `planificada`, `en_curso`, `terminada` y la nueva `cerrada`. Cerrar exige certificados facturados y facturas cobradas |
| Consultar stock al cotizar sin reservar, mostrar faltante | ✅ | Panel "Stock para esta cotización" en el costeo (`src/components/quote-stock.tsx`) |
| Aprobar reserva lo disponible y genera faltante con alerta a Compras | ✅ | `src/lib/reservations.ts`: reserva, solicitud de compra con necesidad/reservado/faltante, aviso a Compras |
| La reserva se consume con la salida a la obra y se libera si la cotización se cae | ✅ | |
| Prioridad de reservas | ⏳ | Por orden de aprobación hasta que se defina (punto 16) |

Los insumos de la cotización se buscan en el stock por vínculo, por código interno o por nombre
exacto. Lo que no se encuentra cuenta como faltante entero.

## 5. Ruta Venta-Abastecimiento-Compra-Pago

| Requisito | Estado | Cómo |
|---|---|---|
| Solicitud y OC atadas a cotización/obra, con fecha requerida y prioridad | ✅ | `Purchase.quoteId`, `neededBy`, `priority`, `requestLines` |
| Factura de compra A/C/X atada a la OC y al remito o conformidad | ✅ | `Expense.purchaseId`, `receiptRef`; hereda empresa, proveedor y obra |
| Orden de pago desde la factura; pago desde la OP | ✅ | `Payment.status`: emitida (no descuenta) → pagada. Número OP-n, retenciones, vencimiento |
| Ruta cerrada, en los dos sentidos | ✅ | Compras › Ruta de compras, con control de tres vías y documentos sin vínculo |
| Una OP que agrupa varias facturas | ⏳ | Hoy una OP es de una factura |

## 6. Venta de materiales: remito y factura

✅ Remito desde el Salón · ✅ factura que junta varios remitos del mismo cliente y empresa ·
✅ la factura no vuelve a descontar · ✅ devolución del cliente con remito de entrada ·
⏳ facturación parcial de un remito (decisión pendiente: hoy se factura el remito entero) ·
⏳ nota de crédito de la devolución.

## 7. Matriz de trazabilidad

Obra con y sin certificación, venta de materiales y compra de materiales se recorren en
Comercial › Seguimiento (venta) y Compras › Ruta de compras (compra).

## 8. Facturación y cobranza parcial

| Indicador | Estado |
|---|---|
| Cotizado vigente, certificado, facturado, habilitado para facturar | ✅ (Seguimiento) |
| Cobrado aplicado, anticipos no aplicados, pendiente de cobro, total recibido | ✅ |
| % facturado y % cobrado sobre lo cotizado, % cobrado sobre lo facturado | ✅ |
| Adicionales y reducciones de la cotización; notas de crédito y débito | ⏳ |
| Fondo de reparo y retenciones de venta por separado | ⏳ (existe la cuenta GGD - Fondo de Reparo) |

## 9. Tipos de comprobantes

| Requisito | Estado | Cómo |
|---|---|---|
| Venta: A y B fiscales, X interna | ✅ | `factura_a`, `factura_b`, `factura_x` |
| Compra: A y C fiscales, X interna | ✅ | En Facturas de compra |
| Configurables por CUIT y punto de venta | ✅ | Configuración › Empresas y comprobantes (talonarios) |
| La X con numeración interna | ✅ | Se toma del talonario al guardar, por empresa (`X-0001-00000001`) |
| La X fuera de reportes fiscales | ✅ | Contabilidad › Libro IVA no la incluye nunca |
| La X sí cuenta para gestión | ✅ | Cuentas corrientes, recibos, tablero, rentabilidad |
| X sustituida por fiscal sin duplicar | ✅ | Botón "Sustituir": la X queda sustituida y lo cobrado pasa a la fiscal |

## 10. Costos, obras, personal y activos

Sin cambios en esta versión: lo que ya existía (costos por obra, partes diarios, bienes de uso
con mantenimiento) sigue igual. ⏳ material alternativo, costo para finalizar, desgaste de herramientas.

## 11. Tesorería y plan de cuentas

| Requisito | Estado | Cómo |
|---|---|---|
| Catálogo maestro del Anexo A (80 cuentas) | ✅ | Maestros › Plan de cuentas; se carga solo la primera vez |
| Todo ingreso y egreso con cuenta obligatoria | ✅ | Caja y bancos, recibos y pagos no se guardan sin cuenta |
| Ingreso solo a CI; egreso a CE, CC, GGD, GGI, IMP, OP o BB | ✅ | Validado en el servidor |
| Sin cuenta libre ni inactiva | ✅ | Se elige del catálogo; las desactivadas no se ofrecen ni se aceptan |
| Movimiento entre cuentas propias vinculado | ✅ | Botón en Caja y bancos: egreso CE + ingreso CI con el mismo identificador |
| Cambio de cuenta con usuario, fecha, anterior, nueva y motivo | ✅ | `accountHistory` en cada movimiento |
| Reportes por código y cuenta | ✅ | Contabilidad › Movimientos por cuenta |
| Control de duplicados de movimientos entre cuentas | ✅ | Avisa y pide confirmar |
| Control de duplicados de acreditación de cheques | ⏳ | |
| Alerta si una operación de obra no tiene obra o centro de costo | ⏳ | El movimiento de caja ya tiene obra y centro de costo |

Los movimientos cargados antes del plan de cuentas no tienen cuenta: aparecen como "Sin cuenta"
en Movimientos por cuenta y se imputan editándolos.

## 12. Reportes

Comercial (Seguimiento), Compras (Ruta de compras), Logística (Stock, Transferencias, Remitos),
Finanzas (Movimientos por cuenta, Libro IVA) y Trazabilidad (documentos sin vínculo) ✅.
⏳ cobros/pagos proyectados y liquidez; rentabilidad con costo para finalizar.

## 14. Roles y auditoría

✅ Bitácora completa en Seguridad › Bitácora de cambios (usuario, fecha y hora, valor anterior y
nuevo). ⏳ responsables parametrizables por documento (genera / revisa / autoriza / confirma).

## 16. Decisiones pendientes de validación

Siguen abiertas y el sistema quedó con un criterio provisorio, fácil de cambiar:

| Tema | Criterio provisorio |
|---|---|
| Movimiento entre empresas | No hay documento propio: el material conserva su dueño aunque lo use o lo facture la otra |
| Propiedad y valuación | Costo promedio único por material; el dueño se lleva por cantidad |
| Prioridad de reservas | Por orden de aprobación |
| Tolerancias OC-remito-factura | 5 % (`THREE_WAY_TOLERANCE` en `src/lib/purchase-route.ts`) |
| Factura por remito | Remito entero; varios remitos por factura |
| Comprobantes X | Numeración por empresa y punto de venta; se sustituye con "Sustituir" |
| Contabilidad | Sin asientos automáticos: solo imputación a cuentas de caja |
| Migración | Lo histórico queda sin cuenta y sin dueño ("sin asignar") hasta que se edite |
