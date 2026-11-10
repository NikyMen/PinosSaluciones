# Solicitudes de compra para stock

- Fecha: 2026-11-10.
- La nueva solicitud carga materiales existentes o nuevos por ítem: cantidad, unidad, costo neto, rubro e IVA 0 %, 10,5 %, 21 % o 27 %. El servidor recalcula cada neto y el total.
- La modalidad predeterminada es cargar a stock después de aprobar (`stockOnApproval`), con destino Galpón (`central`) o Salón de Ventas (`salon`), independiente de la empresa titular; proveedor opcional.
- Guardar conserva el borrador; emitir siempre espera aprobación explícita de Gerencia o de quien tenga Autorizar compras, sin excepción por monto. Rechazar no altera stock.
- Aprobar genera la OC y registra la recepción completa en el depósito elegido, con el costo neto y el propietario de la compra. El material existente se suma; el nuevo se crea al recibir. La recepción cierra la OC y no se vuelve a ingresar con otra aprobación o remito.
- La compra a proveedor mantiene el circuito de aprobación por monto y recepción por remitos; las solicitudes anteriores siguen disponibles para edición en borrador.
- Proveedor, percepciones, impuesto interno, obra, cotización y fechas adicionales quedan en un bloque desplegable.
- No requiere migración de datos existentes. Despliegue: `deploy/compras-stock.md`.
