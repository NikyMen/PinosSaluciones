# Solicitudes de compra para stock

- Fecha: 2026-11-10.
- La nueva solicitud carga materiales existentes o nuevos por ítem: cantidad, unidad, costo neto, rubro e IVA 0 %, 10,5 %, 21 % o 27 %. El servidor recalcula cada neto y el total.
- La modalidad predeterminada es cargar a stock después de aprobar (`stockOnApproval`), con destino Galpón (`central`) o Salón de Ventas (`salon`), independiente de la empresa titular; proveedor opcional.
- Guardar conserva el borrador; emitir siempre espera aprobación explícita. Todas las compras requieren aprobación explícita. Hasta $500.000 aprueba quien puede gestionar compras (o tiene Autorizar compras); por encima de $500.000 sólo el rol Gerencia, aunque otro usuario tenga ese permiso. El límite se mide sobre el total final con impuestos. Rechazar no altera stock.
- Aprobar genera la OC y registra la recepción completa en el depósito elegido, con el costo neto y el propietario de la compra. El material existente se suma; el nuevo se crea al recibir. La recepción cierra la OC y no se vuelve a ingresar con otra aprobación o remito.
- La compra a proveedor también requiere aprobación explícita y mantiene la recepción por remitos; las solicitudes anteriores siguen disponibles para edición en borrador.
- Proveedor, percepciones, impuesto interno, obra, cotización y fechas adicionales quedan en un bloque desplegable.
- No requiere migración de datos existentes. Despliegue: `deploy/compras-stock.md`.

- Cada fila ofrece Aprobar y el detalle del total final (neto, IVA por alícuota, percepciones e impuesto interno). Una solicitud en borrador se valida y emite al aprobarla. Las ya aprobadas muestran Aprobada; las anuladas o rechazadas no admiten aprobación.
- Las órdenes anteriores emitidas sin aprobación registrada se pueden aprobar, sin generar otra OC ni repetir movimientos de stock. Las órdenes ya recibidas conservan su recepción.
