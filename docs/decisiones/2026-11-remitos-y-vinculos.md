# Remitos y vínculos entre documentos

Decisión del 16/11/2026, etapa 3 del relevamiento de Compras, Ventas y Tesorería.

- En Compras, **Factura con remito** exige al menos un remito. Se pueden elegir remitos pendientes de la OC y remitos sin OC del mismo proveedor, incluso de períodos anteriores. Los precios unitarios se cargan sobre los renglones recibidos. El servidor obtiene el neto del subtotal menos el descuento y evita facturar dos veces el mismo remito. **Factura sin remito** permite cargar servicios y, si viene de una OC con artículos, calcular con los artículos y cantidades de la orden.
- En Ventas, **Factura con remito** abre el selector de remitos pendientes de un cliente y empresa y permite facturarlos parcial o totalmente. El remito ya registró la salida de stock. **Factura** abre la carga de servicios y mano de obra.
- **Remito sin OC** pide número, fecha, proveedor, cotización u obra y materiales con cantidad y unidad. Registra la entrega para facturarla. Las recepciones contra OC actualizan stock.
- La empresa, el proveedor, la cotización y la obra salen de la OC al cargar la factura desde la orden. Desde **Vinculado** se consultan la OC, cotización, obra, remitos y órdenes de pago. Si la factura se cargó primero, la misma ficha permite asociar una OC del proveedor o una cotización relacionada, incluso si la factura ya tiene OP. El sistema recalcula lo pagado de la OC.
- Gerencia administra los rubros en Perfil › Configuración › Empresas y comprobantes. La lista inicial incluye Trabajo en altura, Albañilería, Pintura interior, Pintura exterior, Impermeabilización y Poliuretano/Poliurea. El rubro se pide al crear, editar o aprobar la cotización. La importación de cotizaciones usa la columna **Rubro de obra** con el nombre del rubro. Se copia a la obra y se hereda en la compra y la factura.

Los campos nuevos son opcionales en MongoDB para conservar los comprobantes y cotizaciones existentes. Los modos nuevos se validan en los formularios y en la API al elegirlos. Los remitos facturados tienen un índice único parcial para evitar que dos facturas nuevas concurrentes tomen el mismo remito.
