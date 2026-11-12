# Decimales, descuentos, OC con proveedor y obra, importación de cotizaciones

- Fecha: 2026-11-12.
- Origen: pedidos de Administración por mensaje (11 y 12/11/2026).

## OC sin proveedor ni obra

- Se emitió la OC-9 sin proveedor ni obra: la solicitud para stock tenía el proveedor opcional y la obra no se pedía.
- Decisión: **proveedor y obra obligatorios en toda solicitud**, también la que va a stock del Galpón o del Salón. `emitRequest` (`src/lib/purchase-flow.ts`) no emite (ni aprueba, que emite antes) sin ellos, y el pedido del buscador de precios (`src/lib/purchase-orders.ts`) pide la obra antes de crear la solicitud. En el formulario los dos van a la vista, obligatorios.
- Las solicitudes en borrador que ya existían sin proveedor u obra se completan al editarlas; las OC ya emitidas no cambian.

## Importes con decimales

- La orden de pago no se emitía con medios que "sumaban lo mismo": la OP era de $461.650 y los medios sumaban $461.649,96, pero `money()` mostraba todo sin centavos y en pantalla se veían iguales. Lo mismo hacía que el neto de compras pareciera redondeado.
- Decisión: `money()` muestra siempre dos decimales, en toda la aplicación y en los PDF. Los cálculos ya eran en centavos: no cambia ningún importe guardado.
- En `MoneyInput`, el punto del teclado numérico escribe la coma decimal (`decimalPointToComma` en `src/lib/format.ts`). Los puntos de los miles los sigue poniendo la máscara.

## Descuentos en pesos

- Pedido: descuento por artículo cargado o vendido y en las facturas, con importe y no con porcentaje.
- Compras: cada renglón de la solicitud lleva `discountCents`; `totalCents = cantidad × unitCents − discountCents` (`purchaseLineNetCents`). El IVA va sobre el neto con descuento. La OC lo copia, su PDF lo muestra en BONIF. y el costo que entra a stock es el neto del renglón por unidad.
- Remitos de venta: cada renglón lleva `discountCents` y su total ya viene con él restado. Facturado en partes, el total del renglón se reparte en proporción a la cantidad (`lineNetCents`), así el descuento acompaña.
- Facturas emitidas y recibidas: se carga el subtotal sin IVA y el descuento o bonificación (`discountCents`); `netCents` es la resta y es lo que va a ARCA, al libro IVA y a las percepciones. El PDF fiscal muestra el renglón por el subtotal y abajo la bonificación (en la B, con su IVA).
- El descuento por porcentaje de la ficha del proveedor (listas de precios) sigue como estaba.

## Importación de cotizaciones

- Pedido: cargar las cotizaciones existentes desde Excel, como clientes y proveedores.
- Decisión: la importación genérica (`src/app/api/import/[entity]/route.ts`) suma el botón **Plantilla** (CSV con los encabezados del formulario) y entiende lo que escribe una persona: cliente u obra por nombre, CUIT o código; selects por su etiqueta; fechas en dd/mm/aaaa; lo que falta toma el valor por defecto del formulario. La fila `sep=;` del CSV se saltea.
- Las cotizaciones entran con su importe, sin el detalle de ítems.

## Despliegue

- No requiere migración: los campos nuevos son opcionales y lo guardado vale igual.
