# Solicitudes por ítems e ingreso aprobado a stock

Cambio de noviembre de 2026: ver `docs/decisiones/2026-11-solicitudes-stock.md`.

No requiere migración ni modifica solicitudes existentes. Se despliega con el procedimiento de actualización del README: `pnpm install --frozen-lockfile`, `pnpm build` y recarga de PM2. Hacer el backup manual documentado antes de actualizar.

Verificar en una base de prueba que una solicitud con destino Galpón o Salón de Ventas e IVA 0 % no ingrese materiales al guardar o emitir; sólo la aprobación genera la OC y su recepción. Rechazar y repetir la aprobación no suman stock. No crear movimientos de prueba en producción.
