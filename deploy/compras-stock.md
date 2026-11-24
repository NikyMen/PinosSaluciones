# Solicitudes por ítems e ingreso aprobado a stock

Cambio de noviembre de 2026: ver `docs/decisiones/2026-11-solicitudes-stock.md`.

No requiere migración ni modifica solicitudes existentes. Se despliega con el procedimiento de actualización del README: `pnpm install --frozen-lockfile`, `pnpm build` y recarga de PM2. Hacer el backup manual documentado antes de actualizar.

Verificar en una base de prueba que una solicitud con destino Galpón o Salón de Ventas e IVA 0 % no ingrese materiales al guardar o emitir; sólo la aprobación genera la OC y su recepción. Rechazar y repetir la aprobación no suman stock. No crear movimientos de prueba en producción.

Actualización de aprobaciones: no requiere migración. Toda nueva solicitud espera aprobación explícita. Verificar hasta $500.000 con Compras y por encima sólo con Gerencia; el permiso Autorizar compras no habilita importes superiores. Las filas muestran el botón y el desglose del total final. Las órdenes existentes ya recibidas no se vuelven a ingresar.

Anular y corregir compras aprobadas (20/11/2026, `docs/decisiones/2026-11-anular-y-corregir-compras.md`): no requiere migración; los remitos existentes quedan sin anular (`cancellation` vacío). Verificar en una base de prueba que Compras anule una compra a stock aprobada de hasta $500.000 (y por encima sólo Gerencia) y el stock vuelva a lo de antes, que se rechace si ya tiene factura o el material no está, y que Corregir deje una SC nueva en borrador. En producción la anulación mueve stock de verdad: hacer el backup manual antes de la primera.

Cambiar proveedor (24/11/2026): no requiere migración. Cambia el proveedor de la compra, sus remitos y sus ingresos a stock sin mover cantidades.
