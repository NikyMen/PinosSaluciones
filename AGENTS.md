<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Proyecto

- Hablá con el usuario en español rioplatense. Los commits van en español, con el estilo del repo (`feat: ...`, `fix: ...`).
- Cuando cambie algo del proyecto o del servidor (rutas, deploy, convenciones), actualizalo en todos los lugares donde esté documentado: `README.md`, este archivo, `docs/` y `deploy/`. Buscá el dato viejo en todo el repo y corregí cada aparición.
- **El repo es público.** No escribas IPs, usuarios, contraseñas, URIs con credenciales ni datos de acceso SSH en archivos versionados.

## Producción

- Obras: listado y edición sin presupuesto; inicio/fin previstos (`startDate`, `endDate`) y reales (`actualStartDate`, `actualEndDate`). Estado de obra permite cambiar estado y avance manual sin base de inspecciones; con base conserva el cálculo automático. La fila se pinta proporcionalmente en rojo. Los presupuestos internos se conservan para certificación y facturación. Ver `docs/requerimientos/obras.md` y `deploy/obras.md`.

- Compras › Solicitudes y órdenes: carga por ítems con IVA 0/10,5/21/27 %. `stockOnApproval` requiere aprobación explícita por cualquier importe, proveedor opcional, destino Galpón o Salón de Ventas y forma de pago a la vista, como la compra a proveedor; recién al aprobar genera OC y recepción a stock. Todas las compras requieren aprobación explícita. Hasta $500.000 aprueba quien puede gestionar compras (o tiene Autorizar compras); por encima de $500.000 sólo el rol Gerencia, aunque otro usuario tenga ese permiso. El límite se mide sobre el total final con impuestos. Cada fila muestra Aprobar (o Aprobada) y el detalle de neto, IVA, otros impuestos y total. La compra a proveedor mantiene la recepción por remito. Ver `docs/decisiones/2026-11-solicitudes-stock.md`.

Cómo está armado y cómo se actualiza: `README.md`, secciones "Despliegue en VPS", "Actualizar producción" y "Backups". En resumen:

- Código en `/var/www/pino-soluciones`; PM2 corre `pinos-web` (puerto 3515) y `pinos-worker`; nginx + Certbot adelante; MongoDB en Docker (container `mongodb`).
- En SSH no interactivo, `pm2` no está en el `PATH`: usar `/root/.local/share/pnpm/bin/pm2`.
- Certificados de ARCA (factura electrónica) en `/etc/pinos/arca/` (`ARCA_CERT_DIR`), fuera del repo; ver la sección "Factura electrónica (ARCA)" del README.
- No hay backup automático: antes de un deploy que toque datos, hacer el dump manual del README.
- Antes de tocar datos, confirmá con `nslookup pinosoluciones.consultoriadigital.io` que estás en el servidor al que apunta el dominio. Hay una instancia vieja en otro VPS que no es producción.
