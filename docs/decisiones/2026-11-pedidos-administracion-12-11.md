# Pedidos de Administración del 12/11 y del 16/11

- Fecha: 2026-11-16.
- Origen: mensajes de Administración del 12/11 y del 16/11/2026, el documento "Cambios Sistema" (12/11) y la planilla de cotizaciones.
- Lo del 12/11 que ya estaba resuelto (proveedor y obra obligatorios en la OC, decimales, el punto que escribe la coma, descuentos en pesos y la OP que no se emitía por los centavos) está en `2026-11-decimales-descuentos.md`.

## Número de las facturas de venta

- **A y B: el número lo da ARCA.** Con "Emitir ahora en ARCA (con CAE)" el número ya no se escribe ni se desbloquea. El formulario muestra el que sigue en ARCA, y ARCA asigna el definitivo al guardar (`src/components/invoice-fields.tsx`).
- **Punto de venta propio.** Hasta ahora los talonarios de A y B estaban en el 0001, que ARCA no tiene de alta para web services, y por eso aparecía el error "no tiene un talonario de Factura A en un punto de venta de web services de ARCA (0003, 0004)". El sistema emite por puntos de venta que Tango no usa: **TV Pino por el 0004** y **Constructora por el 0003**. Tango sigue con el 0003 (TV Pino) y el 0002 (Constructora). Es un cambio de datos en los talonarios (Perfil › Configuración › Empresas y comprobantes), no de código.
- **X: numeración interna.** Sigue al último número del talonario X de la empresa. La primera es la X0001-00000001. Se muestra sin espacio ni guion después de la X.

## Orden de pago

- **Todos los campos del medio son obligatorios** (`src/lib/payment-order-media.ts`, lo usan el formulario y la API). Siempre se piden la caja o cuenta y el importe; con varios medios, uno en $ 0 da error en vez de descartarse. El cheque y el e-Cheq piden además número, banco, fecha de cobro y comprobante. La transferencia, la tarjeta y "otro" piden el número (la referencia) y el comprobante. El efectivo no pide comprobante: su constancia es la firma de quien recibe en el PDF de la OP. Las OP de antes se siguen viendo y editando.
- **PDF con comprobantes.** Después de la hoja de la OP, el PDF trae los comprobantes de cada medio: los PDF página por página (`pdf-lib`) y cada imagen en una página A4. Así la OP y sus comprobantes se le mandan juntos al proveedor. Sale así en "Emitir la OP", en la lista de órdenes de pago y en el detalle de la compra. Un archivo que no se puede leer se saltea. El ZIP del expediente sigue con la OP sola, porque ya agrega los archivos aparte.
- **Forma de pago en el PDF.** Cada medio va en su renglón: `e-Cheq N° 12042030 - Banco Corrientes - $ 231.000,00 - Fecha de pago: 18/12/2026`. Lleva el número completo, el banco, el importe y la fecha.
  - **Banco:** en un cheque, el del cheque. En otro medio, el campo "Banco" de la cuenta.
  - **Fecha:** en un cheque, la de cobro. En otro medio, la de la OP.
  - El nombre interno de la cuenta ("Cheques diferidos … Sub-Cuenta 2") ya no aparece en el PDF.

## Factura de compra

- **Sin Obra ni Categoría.** Lo que entra por OC va al depósito y la obra la pone el remito con que sale, que la pide como obligatoria. Por eso la factura (cualquier comprobante) ya no muestra esos campos. La categoría queda en "materiales" (`ExpenseSchema`). Si la factura viene de una OC, la obra se sigue tomando de la OC. Un gasto sin comprobante sigue pidiendo obra y categoría.

## Cotizaciones de la planilla

- Se cargan con `pnpm quotes:import` (`scripts/import-quotes.ts`, ver README › Actualizar producción).
- La letra del número da la empresa: V es TV Pino y C es Constructora.
- APROBADO, EN EJECUCIÓN y FINALIZADO quedan **pasadas a obra**. La obra queda pendiente de inicio, en curso o finalizada, con código `OB-<número>`. Si ya existía una obra con ese número (la `V1495 BM2` de la planilla de quincena), se le asocia la cotización.
- No se reserva stock ni se mandan avisos: son trabajos que ya están en marcha.
- El rubro sale del trabajo: altura y limpieza de vidrios → Trabajo en altura, espuma/poliurea → Poliuretano, revoque/durlock → Albañilería, pintura → Pintura exterior. Mano de obra y materiales quedan sin rubro.
- El cliente se busca por nombre. Si no está, se da de alta.
- Quedaron afuera la fila "LOGISTICA ???", la segunda C 01-2153 (SIN RESPUESTA), la segunda C 01-2237 (otro importe) y la V 01-1551, que ya estaba cargada. La V 01-1529 tiene el presupuesto en dólares (300 USD): va en $ 0 con la nota.
