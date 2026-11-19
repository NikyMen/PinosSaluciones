# Mostrador: venta al público del Salón

- Fecha: 2026-11-19.
- Origen: pedido de Gerencia ("un módulo de venta al público de nuestros productos"). Cierra STK-7 de `docs/requerimientos/stock.md` y la "Venta mostrador" de `docs/gap-analysis.md`.

## Qué había

La venta al público del Salón se podía hacer, pero en tres pantallas: Ventas › Remitos de venta (baja el stock del Salón), Ventas › Facturas de venta (factura el remito) y Ventas › Cobranzas y recibos (el cobro). Para atender a alguien en el mostrador era lento y fácil de dejar a medias. La Caja de Stock y logística escanea e imprime tickets, pero sus salidas van sólo a obra.

## Decisión

- **Ventas › Mostrador (venta al público)** (`/app/mostrador`; en el menú V1, en Comercial): una sola pantalla que escanea o busca los productos, elige el comprobante y el cobro y, al cobrar, hace todo junto (`src/lib/counter-sales.ts`, `POST /api/mostrador`):
  1. el **remito de venta** al cliente, que baja el stock del Salón de Ventas (como siempre: si está en el Galpón, primero se transfiere);
  2. la **factura** de ese remito: **B o A emitida en ARCA** con CAE, o la **X** interna. El alta de facturas se sacó de la ruta genérica a `src/lib/invoice-create.ts` y la usan las dos pantallas, con las mismas reglas;
  3. el **recibo** con uno o varios medios (efectivo, transferencia, tarjeta, cheque…) a la cuenta del plan `CI - VENTA DE MATERIALES`.
- Cada venta queda como `VM-n` (colección `countersales`) con su remito, factura y recibo, para el **ticket** de la ticketera (58 u 80 mm, el mismo ajuste que la Caja) y el **cierre del día** (total por medio de cobro y por comprobante).
- **Precio**: el de venta sin IVA de Stock (`salePriceCents`), editable en la venta, con descuento en pesos por renglón. El total suma el 21 % de IVA en A y B; la X no lleva IVA.
- **Cliente**: sin elegir, se vende al cliente genérico **"Consumidor Final"** (se crea solo la primera vez, sin CUIT). El comprador puede dar su nombre y su DNI o CUIT, que van en la factura (`buyerName`, `buyerDocument`) y a ARCA. Se puede elegir un cliente o darlo de alta sin salir; la letra sigue a su condición de IVA (A al inscripto y al monotributista, B al resto).
- **Factura B a consumidor final en ARCA**: hasta ahora el pedido de CAE siempre iba con CUIT (DocTipo 80). Ahora a un consumidor final se le factura con DNI (DocTipo 96) o sin identificar (DocTipo 99, número 0). Desde $ 10.000.000 ARCA pide identificarlo (RG 5700/2025) y el sistema no deja emitir sin documento (`CONSUMER_ID_THRESHOLD_CENTS` en `src/lib/fiscal.ts`, `checkReceiver` en `src/lib/arca.ts`). El PDF fiscal y el QR llevan el mismo documento, y la condición de venta "Contado".
- **Permisos**: ve el Mostrador quien ve Facturas de venta; vende quien puede mover stock, cargar facturas y cobrar.

## Qué pasa si algo falla

- Antes de mover el stock se revisa todo lo que puede fallar: que lo cobrado dé el total, el talonario de la empresa, que la empresa esté conectada con ARCA (si es A o B), que el comprobante corresponda al comprador y que cada caja o cuenta sea de la empresa y sirva para ese medio.
- Si la factura no sale (ARCA la rechaza, por ejemplo), el remito se anula y el material vuelve al Salón.
- Si la factura salió y el recibo no, la venta queda **"Sin cobro"** con el aviso y se cobra desde Ventas › Cobranzas y recibos.
- Una devolución se hace como siempre: devolución del remito en Remitos de venta y nota de crédito en Facturas de venta.

## Pendiente

- La importación del catálogo del Salón con sus precios (el Excel de Cristian, ver `docs/decisiones/2026-11-ventas-del-salon.md`): hasta entonces, el precio de venta se carga en la ficha de cada material.
