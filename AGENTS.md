<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Proyecto

- Hablá con el usuario en español rioplatense. Los commits van en español, con el estilo del repo (`feat: ...`, `fix: ...`).
- Cuando cambie algo del proyecto o del servidor (rutas, deploy, convenciones), actualizalo en todos los lugares donde esté documentado: `README.md`, este archivo, `docs/` y `deploy/`. Buscá el dato viejo en todo el repo y corregí cada aparición.
- **El repo es público.** No escribas IPs, usuarios, contraseñas, URIs con credenciales ni datos de acceso SSH en archivos versionados.

En V1 y V2, Gerencia accede desde el botón de perfil a Configuración › Empresas y comprobantes y a Seguridad › Usuarios y permisos / Bitácora de cambios.

## Producción

- Obras: inicio y fin previstos y reales, duración en días hábiles y el avance real en una línea azul a lo ancho de la fila y, pegada abajo, la línea del avance esperado según el plan (días hábiles transcurridos desde el inicio previsto sobre la duración prevista), verde o naranja si se aparta 5 puntos o más. Gerencia y quien tiene Ver presupuesto de obras ven la columna Presupuesto. El estado permite avance manual sin base de inspecciones y cálculo automático con base. La cotización lleva ubicación y fotos que se copian a la obra, donde se puede corregir la ubicación. El mapa requiere permiso de Obras. Ver `docs/requerimientos/obras.md`, `docs/decisiones/2026-11-planificacion-y-mapa-de-obras.md` y `deploy/obras.md`.

- Compras › Solicitudes y órdenes: carga por ítems con IVA 0/10,5/21/27 %. `stockOnApproval` requiere aprobación explícita por cualquier importe, destino Galpón o Salón de Ventas y forma de pago a la vista, como la compra a proveedor; recién al aprobar genera OC y recepción a stock. Todas las compras requieren aprobación explícita. Hasta $500.000 aprueba quien puede gestionar compras (o tiene Autorizar compras); por encima de $500.000 sólo el rol Gerencia, aunque otro usuario tenga ese permiso. El límite se mide sobre el total final con impuestos. Cada fila muestra Aprobar (o Aprobada) y el detalle de neto, IVA, otros impuestos y total. La compra a proveedor mantiene la recepción por remito. Proveedor y obra son obligatorios en toda solicitud/OC, también la de stock. Ver `docs/decisiones/2026-11-solicitudes-stock.md`. Una compra emitida no se edita: la anula o la **corrige** quien la podría aprobar (hasta $500.000 quien gestiona compras o tiene Autorizar compras; por encima, sólo Gerencia) (anula y abre una solicitud nueva en borrador con los mismos datos). Si sólo está mal el proveedor, la misma persona usa **Cambiar proveedor**, mientras la compra no tenga OP ni facturas. La de stock aprobada se anula deshaciendo el ingreso (`ingreso_anulado`) si no tiene factura y el material sigue en el depósito. Ver `docs/decisiones/2026-11-anular-y-corregir-compras.md`.

- Importes y descuentos: todo importe se muestra con centavos (`money()` en `src/lib/format.ts`) y el punto del teclado numérico escribe la coma en `MoneyInput`. Descuentos en pesos: por renglón en compras (`items[].discountCents`) y remitos de venta (`lines[].discountCents`), y por comprobante en facturas emitidas y recibidas (`discountCents`; `netCents` ya viene con el descuento restado). Ver `docs/decisiones/2026-11-decimales-descuentos.md`.

- Tesorería: la OP y el recibo pueden ir a cuenta (`onAccountCents`, sin factura) y se aplican a la factura editándolos. El cheque de terceros que sobra queda a cuenta del proveedor. Una factura recibida con OP solo cambia la descripción y los adjuntos. Una factura emitida vieja se carga como "ya emitida", con su número. Ver `docs/decisiones/2026-11-tesoreria-a-cuenta.md`.

- Formularios de Tesorería y Compras: factura de compra con número 4 + 8 (la letra la da el comprobante) y percepciones por importe (sólo el IVA en %); al cargar facturas no se elige el estado. La OP está en el menú Compras, toma el tipo de gasto y la obra de la factura, no tiene "Pago" y no ofrece e-Cheq (el cheque sale sólo de cuentas de cheques diferidos). La solicitud de compra permite cargar precios con IVA incluido. Ver `docs/decisiones/2026-11-tesoreria-formularios.md`.

- Remitos y vínculos: Compras y Ventas tienen altas de factura con y sin remito. El remito de compra sin OC pide proveedor, cotización u obra y materiales. La factura de compra calcula el neto a partir de los remitos pendientes y los precios, puede asociar la OC o cotización después y reúne todos los comprobantes en Vinculado. La cotización requiere un rubro editable desde Perfil › Configuración › Empresas y comprobantes. Ver `docs/decisiones/2026-11-remitos-y-vinculos.md`.

- Historial del hilo de documentos: botón Historial en cotización, obra, compras, remitos, facturas, OP y recibos. Abre una línea de tiempo con todo lo vinculado, en orden de fecha, en los cuatro conjuntos (Cotización / Obra, Compras, Ventas, Tesorería), con "Asociado después" sacado de la bitácora. No se guarda: se arma en cada consulta (`src/lib/document-thread.ts`). La compra corregida apunta a la que reemplaza con `Purchase.correctsId`. Ver `docs/decisiones/2026-11-historial-de-documentos.md`.

- Notas de crédito y débito de venta: con referencia (factura asociada) o sin referencia (llevan el período que corrige, que va a ARCA como `PeriodoAsoc`). La nota de crédito sin referencia, o lo que sobra de una con referencia, queda a favor del cliente (`Invoice.creditCents`): se ve en el recuadro "A favor de clientes" de Facturas de venta y se aplica a una factura del mismo cliente y empresa con **Aplicar a una factura** o con **Usar** desde el recibo (`src/lib/credit-notes.ts`). No entra plata y se puede deshacer. Ver `docs/decisiones/2026-11-pendientes-ronda-10-11.md`.

- Indicadores y documentos: las listas de facturas muestran pendientes y saldos. La cotización y su obra muestran facturación y cobranza. Gerencia configura la firma del recibo y la OP por empresa. Administración tiene Compras en solo lectura por defecto y puede cargar facturas y OP. Ver `docs/decisiones/2026-11-indicadores-y-recibos.md`.

- Ventas del Salón: facturas por productos y conceptos, con PDF y alta rápida de clientes. Un remito a obra baja stock del Salón y registra a quien recibe. La cotización aprobada notifica a Compras, Obras y Administración, y a Gerencia (sólo aviso, con quién la aprobó). Compras recibe la lista de faltantes para armar la solicitud. Ver `docs/decisiones/2026-11-ventas-del-salon.md`.

- Mostrador (Ventas › Mostrador, `/app/mostrador`): venta al público en un paso. Lista de productos con stock que se filtra con cada letra (o escaneo), precio sin IVA y con IVA calculados uno del otro, Guardar/Editar que graba el precio en Stock (con historial de precios: botón Precios en Stock, `src/lib/sale-prices.ts`); los productos de Protex toman el precio final de la lista vigente (al cargar cada lista y al darse de alta; carga inicial con `pnpm prices:from-list`) y los de la lista que no están en Stock se ven "Sin stock", descuento por renglón, botón Servicio para cobrar servicios (conceptos sin stock, solos o junto con productos), consumidor final o cliente elegido, y sólo el medio de cobro (efectivo, transferencia o tarjeta: la caja o cuenta la elige el sistema). Vende del Salón y, si no alcanza, del Galpón (o de uno solo). Al cobrar hace el remito, la factura del remito (B o A en ARCA, o X) y el recibo a `CI - VENTA DE MATERIALES`, y deja la venta `VM-n` con ticket y cierre del día. La B a consumidor final va a ARCA con DNI o sin identificar (DocTipo 99) hasta $ 10.000.000. El alta de facturas vive en `src/lib/invoice-create.ts`. Ver `docs/decisiones/2026-11-mostrador.md`.

- Pedidos de Administración del 12/11 y del 16/11. Las facturas A y B que se emiten en ARCA no llevan un número escrito: lo asigna ARCA al guardar. TV Pino emite por el punto de venta 0004 y Constructora por el 0003, separados de Tango. La X sigue su talonario desde X0001-00000001. En la OP, cada medio pide todos sus campos, el PDF agrega los comprobantes y la forma de pago sale como "e-Cheq N° … - Banco - $ … - Fecha de pago". La factura de compra no muestra Obra ni Categoría. Las cotizaciones de la planilla se cargan con `pnpm quotes:import`. Ver `docs/decisiones/2026-11-pedidos-administracion-12-11.md`.

- Envíos por transporte (Stock y logística): encomiendas con remito `ENV-n` y valor declarado (cantidad × precio, arranca con el último costo). Bajan stock sin confirmación en destino; después se carga la guía del transporte. Una venta se manda desde su remito (Ventas › Remitos de venta › **Enviar por transporte**): hace el `ENV-n` con el valor declarado del remito y no vuelve a bajar stock. Ver README › Envíos por transporte, `docs/plan-envios-y-traslados.md` y `docs/decisiones/2026-11-pendientes-ronda-10-11.md`.

- Importación: botón Plantilla (`GET /api/import/[entity]`); las relaciones se resuelven por nombre, CUIT o código y las fechas en dd/mm/aaaa. Así se cargan las cotizaciones.

Cómo está armado y cómo se actualiza: `README.md`, secciones "Despliegue en VPS", "Actualizar producción" y "Backups". En resumen:

- Código en `/var/www/pino-soluciones`; PM2 corre `pinos-web` (puerto 3515) y `pinos-worker`; nginx + Certbot adelante; MongoDB en Docker (container `mongodb`).
- En SSH no interactivo, `pm2` no está en el `PATH`: usar `/root/.local/share/pnpm/bin/pm2`.
- Certificados de ARCA (factura electrónica) en `/etc/pinos/arca/` (`ARCA_CERT_DIR`), fuera del repo; ver la sección "Factura electrónica (ARCA)" del README.
- No hay backup automático: antes de un deploy que toque datos, hacer el dump manual del README.
- Antes de tocar datos, confirmá con `nslookup pinosoluciones.consultoriadigital.io` que estás en el servidor al que apunta el dominio. Hay una instancia vieja en otro VPS que no es producción.
