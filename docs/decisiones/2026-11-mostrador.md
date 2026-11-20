# Mostrador: venta al público del Salón

- Fecha: 2026-11-19.
- Origen: pedido de Gerencia ("un módulo de venta al público de nuestros productos"). Cierra STK-7 de `docs/requerimientos/stock.md` y la "Venta mostrador" de `docs/gap-analysis.md`.

## Qué había

La venta al público del Salón se podía hacer, pero en tres pantallas: Ventas › Remitos de venta (baja el stock del Salón), Ventas › Facturas de venta (factura el remito) y Ventas › Cobranzas y recibos (el cobro). Para atender a alguien en el mostrador era lento y fácil de dejar a medias. La Caja de Stock y logística escanea e imprime tickets, pero sus salidas van sólo a obra.

## Decisión

- **Ventas › Mostrador (venta al público)** (`/app/mostrador`; en el menú V1, en Comercial): una sola pantalla que escanea o busca los productos, elige el comprobante y el cobro y, al cobrar, hace todo junto (`src/lib/counter-sales.ts`, `POST /api/mostrador`):
  1. el **remito de venta** al cliente, que baja el stock: primero del Salón de Ventas y lo que falte del Galpón (ver los ajustes, abajo);
  2. la **factura** de ese remito: **B o A emitida en ARCA** con CAE, o la **X** interna. El alta de facturas se sacó de la ruta genérica a `src/lib/invoice-create.ts` y la usan las dos pantallas, con las mismas reglas;
  3. el **recibo** con el medio de cobro (efectivo, transferencia o tarjeta), en la caja o cuenta que corresponde, a la cuenta del plan `CI - VENTA DE MATERIALES`.
- Cada venta queda como `VM-n` (colección `countersales`) con su remito, factura y recibo, para el **ticket** de la ticketera (58 u 80 mm, el mismo ajuste que la Caja) y el **cierre del día** (total por medio de cobro y por comprobante).
- **Precio**: el de venta sin IVA de Stock (`salePriceCents`), editable en la venta, con descuento en pesos por renglón. El total suma el 21 % de IVA en A y B; la X no lleva IVA.
- **Cliente**: sin elegir, se vende al cliente genérico **"Consumidor Final"** (el que ya esté cargado sin CUIT, o uno nuevo la primera vez). Se puede elegir un cliente o darlo de alta sin salir; la letra sigue a su condición de IVA (A al inscripto y al monotributista, B al resto).
- **Factura B a consumidor final en ARCA**: hasta ahora el pedido de CAE siempre iba con CUIT (DocTipo 80). Ahora a un consumidor final se le factura con DNI (DocTipo 96) o sin identificar (DocTipo 99, número 0). Desde $ 10.000.000 ARCA pide identificarlo (RG 5700/2025) y el sistema no deja emitir sin documento (`CONSUMER_ID_THRESHOLD_CENTS` en `src/lib/fiscal.ts`, `checkReceiver` en `src/lib/arca.ts`). El PDF fiscal y el QR llevan el mismo documento, y la condición de venta "Contado".
- **Permisos**: ve el Mostrador quien ve Facturas de venta; vende quien puede mover stock, cargar facturas y cobrar.

## Qué pasa si algo falla

- Antes de mover el stock se revisa todo lo que puede fallar: el talonario de la empresa, que la empresa esté conectada con ARCA (si es A o B), que el comprobante corresponda al comprador y que la empresa tenga una caja o cuenta para el medio elegido.
- Si la factura no sale (ARCA la rechaza, por ejemplo), el remito se anula y el material vuelve a su depósito.
- Si la factura salió y el recibo no, la venta queda **"Sin cobro"** con el aviso y se cobra desde Ventas › Cobranzas y recibos.
- Una devolución se hace como siempre: devolución del remito en Remitos de venta y nota de crédito en Facturas de venta.

## Pendiente

- La importación del catálogo del Salón con sus precios (el Excel de Cristian, ver `docs/decisiones/2026-11-ventas-del-salon.md`): hasta entonces, el precio de venta se carga en la ficha de cada material.

## Ajustes del 19/11/2026 (después de usarlo)

- **Lista de productos**: arriba de la venta se ven los productos con stock en el Salón o en el Galpón, con lo que hay en cada uno y el precio, y la lista se filtra con cada letra que se escribe, sin Enter (por cada palabra, en el nombre o el código: `counterCatalog`). Tocar un producto lo suma. El lector y la cámara siguen sumando directo.
- **Vende lo que está en stock, no sólo el Salón**: antes la venta frenaba si el producto estaba en el Galpón y pedía transferirlo. Ahora "Sale de" es, por defecto, **Salón y Galpón** (primero el Salón y lo que falte del Galpón, `saleParts` en `src/lib/sales-remitos.ts`); también se puede elegir sólo el Salón o sólo el Galpón. El movimiento de venta lleva su depósito y cada renglón del remito también: un producto que sale de los dos depósitos queda en dos renglones, con el descuento repartido según la cantidad. Al anular el remito, cada parte vuelve a su depósito. Remitos de venta sigue vendiendo sólo del Salón.
- **Cobro más simple**: sólo se elige el medio (efectivo, transferencia o tarjeta). La caja o cuenta la elige el sistema (`defaultCashAccount`): la primera activa, por código, de la empresa o compartida, del tipo que corresponde al medio. Si no hay ninguna, avisa que hay que darla de alta en Tesorería › Cajas y cuentas bancarias. Ya no se reparte el cobro entre varios medios desde el Mostrador: un cobro mixto se carga en Cobranzas y recibos.
- **Sin datos del consumidor final**: se sacaron los campos de nombre y DNI. Sin cliente elegido, la B va a "Consumidor Final" sin identificar. El sistema sigue sabiendo emitir con DNI (`buyerDocument`), pero la pantalla no lo pide; desde $ 10.000.000 ARCA exige identificarlo, así que una venta así se hace eligiendo o dando de alta el cliente.

## Precio de venta: con IVA, Guardar, Editar e historial (19/11/2026)

- En cada renglón del Mostrador hay **Precio s/IVA**, **Precio c/IVA** (el 21 %) y **Desc. $**. Escribir uno de los dos precios calcula el otro (`withVatCents` y `withoutVatCents` en `src/lib/counter-totals.ts`). Lo que se guarda y se factura es el precio sin IVA, en centavos: al pasar de un precio con IVA a uno sin IVA puede quedar un centavo de diferencia.
- **Guardar** graba el precio sin IVA en Stock (`PUT /api/stock/[id]/precio`) para las próximas ventas. Si el producto ya tiene precio, los dos campos quedan fijos y aparece **Editar**; al tocarlo se pueden cambiar y se guarda de nuevo. El precio también se puede cambiar para una sola venta sin guardarlo.
- Los precios van en su propia fila del renglón, debajo de la cantidad, para que el botón no quede encima del total ni del tacho.
- **Historial de precios** (`stockpricechanges`, `src/lib/sale-prices.ts`): cada cambio del precio de venta, desde el Mostrador, desde la ficha de Stock o al dar de alta el material, deja el precio anterior, el nuevo, el usuario y la fecha y hora. En Stock y logística › Stock, el botón **Precios** de cada material lo muestra, y también la ficha al editarlo. Los cambios de antes de esta versión no tienen historial (siguen en el historial de cambios general del material).

## Servicios (19/11/2026)

- Al lado de **Cámara** está el botón **Servicio**: suma un renglón para cobrar un servicio (colocación, corte a medida, flete…) con descripción, cantidad, unidad y precio sin IVA o con IVA (se calculan uno del otro). No mueve stock.
- Una venta puede ser sólo de servicios (sin remito: la factura lleva los servicios como conceptos) o de productos y servicios juntos: el remito lleva los productos y la factura, además, los servicios como renglones sueltos. Para eso la factura con remito ahora acepta renglones sin stock (`prepareInvoice`); el neto es lo de los remitos más los servicios y `checkInvoiceExcess` controla que no pase de eso.
- En ARCA el concepto sale de lo que se vende: productos (1), servicios (2) o productos y servicios (3), con el período del mes que piden los servicios.
- Los servicios no se guardan en un catálogo: se escriben en cada venta.

## Precio final de la lista del proveedor (Protex), 20/11/2026

- Pedido de Cristian: ver en el Mostrador la lista de Protex con el precio final de mostrador de la planilla (`consumerGrossCents`, con IVA); a los productos que no son de Protex el precio se lo ponen ellos (Guardar/Editar).
- **Precio de venta desde la lista** (`applyListSalePrices` en `src/lib/sale-prices.ts`): los materiales de Stock que están en una lista vigente con precio final toman ese precio, sin IVA (precio final / 1,21). Se reconocen por el código interno igual al de la lista o por el código antes del guion: "JUE905-BIDON" y "JUE905-BOLSA" son el "JUE905" de la lista (`src/lib/list-price-match.ts`). Si el material tiene proveedor, tiene que ser el de la lista; un material sin código no se cruza.
- **Automático**: al cargar una lista nueva del proveedor, los materiales de esa lista toman el precio nuevo; y un material que se da de alta en Stock (ficha, Caja o recepción de una compra) sin precio toma el de la lista. Los cambios quedan en el historial de precios como "Lista del proveedor".
- **Carga inicial**: `pnpm prices:from-list` (sin `--apply` sólo muestra lo que haría).
- **Sin stock**: en la lista del Mostrador, después de los productos de Stock, se ven los productos de la lista que no están en Stock (o no tienen existencia), con su precio y "Sin stock". Sirven para consultar el precio; no se pueden vender hasta que entren a Stock.
- Un precio que se cambia a mano en el Mostrador o en Stock queda hasta la próxima lista del proveedor, que lo vuelve a poner.
