# Pinos Soluciones — ERP/CRM

Sistema web para centralizar clientes, ventas, obras, proveedores, gastos, facturación administrativa, cobranzas, pagos, cheques, tareas y reportes. Emite las Factura A y B en ARCA con CAE (ver [Factura electrónica (ARCA)](#factura-electrónica-arca)); las que salieron de Tango se pueden cargar a mano. El comprobante interno X se numera en el sistema y queda fuera del libro IVA.

La barra lateral tiene trece módulos: Configuración, Seguridad, Maestros, Comercial, Obras, Compras, Ventas, Stock y logística, Personal, Activos, Tesorería, Contabilidad y Gestión. Desde el menú del usuario (arriba a la derecha) cada persona puede pasar al menú de antes (**V1**: Tablero, Comercial, Obras, Compras y stock, Finanzas e iA y Reportes) o volver al de módulos (**V2**); la elección queda en la cookie `pino-nav` de ese navegador. El Calendario también está en ese menú. Qué hace cada parte de la especificación funcional v1.5 y qué falta: [`docs/requerimientos/especificacion-v1-5.md`](docs/requerimientos/especificacion-v1-5.md).

## Documentación

Los requerimientos, las decisiones y los modelos de negocio viven en [`docs/`](docs/README.md),
que está pensada para abrirse como vault de Obsidian. Empezar por [`docs/00-inicio.md`](docs/00-inicio.md).

Si no conocés el rubro de la construcción, leé primero [`docs/glosario.md`](docs/glosario.md).

## Desarrollo local

Requisitos: Node.js 22 LTS o superior y pnpm 10. **No hace falta instalar MongoDB.**

```bash
cp .env.example .env
pnpm install
pnpm dev
```

`pnpm dev` levanta todo: una MongoDB local que corre desde `node_modules`, el usuario
administrador si todavía no existe, el worker y el servidor web. Se cierra todo junto con Ctrl+C.
Los datos quedan en `.mongo-data/` y sobreviven entre reinicios.

Para levantar solo el web, contra una base que ya esté corriendo en otro lado:

```bash
pnpm dev:web
```

`MONGODB_URI` es la unica variable que cambia entre entornos: en local la define `pnpm dev`;
en el VPS debe ser la URI de la base existente (por ejemplo, con usuario, clave y `authSource=admin`).
No hardcodees la URI en el codigo.
En el VPS se usa el `.env` de la raíz del checkout (`/var/www/pino-soluciones/.env`); también funcionan variables de entorno exportadas por el proceso.

Para cargar datos ficticios de Corrientes sin borrar ni sobrescribir registros existentes:

```bash
pnpm seed:demo
```

Abrir `http://localhost:3000` (o el puerto que informe Next, por ejemplo `3001`) e ingresar con `ADMIN_EMAIL` / `ADMIN_PASSWORD` definidos en `.env`.

## Despliegue en VPS

Producción corre en un VPS propio (el que resuelve `pinosoluciones.consultoriadigital.io`), así:

- Código en `/var/www/pino-soluciones`, con el `.env` en esa misma carpeta.
- PM2 corre `pinos-web` (puerto `3515`) y `pinos-worker`, y arranca solo con el servidor (`pm2 startup` + `pm2 save`).
- Nginx atiende el 80 y el 443 y hace proxy a `127.0.0.1:3515`; el certificado lo emite y renueva Certbot. La base de `deploy/pinosoluciones.nginx.conf` es el bloque `:80`: Certbot agrega solo el 443 y la redirección.
- MongoDB 7 corre en Docker (container `mongodb`), escuchando solo en `127.0.0.1:27017`.
- Los archivos subidos van a `/var/lib/pinos/uploads` (`UPLOAD_DIR`). Las fotos HEIC del iPhone se pasan a JPEG al subirlas (`src/lib/heic.ts`), porque Chrome y Edge no las muestran; se reconocen por el contenido, aunque vengan con extensión `.jpg` o `.png`.
- PM2 está instalado con pnpm global y en una sesión SSH sin terminal interactiva no está en el `PATH`: usar `/root/.local/share/pnpm/bin/pm2` o hacer antes `export PATH=/root/.local/share/pnpm:/root/.local/share/pnpm/bin:$PATH` (pnpm está en la primera carpeta y pm2 en `bin`).

### Instalación desde cero

1. Instalar Node LTS, pnpm, Docker, Nginx, Certbot y PM2 (`pnpm add -g pm2`).
2. Clonar el repositorio en `/var/www/pino-soluciones`.
3. Crear `.env` desde `.env.example` y reemplazar `MONGODB_URI` por la URI de la base del VPS. Usar una `SESSION_SECRET` aleatoria y `APP_URL=https://tu-dominio`. MongoDB debe escuchar solo en localhost o una red privada autenticada.
4. Crear los directorios persistentes: `install -d /var/lib/pinos/uploads /var/backups/pinos`.
5. Ejecutar:

```bash
cd /var/www/pino-soluciones
pnpm install --frozen-lockfile
pnpm db:check
pnpm seed
# Opcional: solo para una instalacion de demostracion
pnpm seed:demo
pnpm build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

6. Publicar el dominio: copiar `deploy/pinosoluciones.nginx.conf` a `/etc/nginx/sites-available/`, enlazarlo en `sites-enabled`, `nginx -t && systemctl reload nginx` y después `certbot --nginx -d tu-dominio`. El dominio ya tiene que resolver a la IP del VPS.
7. Verificar `https://dominio/api/health` y `pm2 status`.

El proceso web escucha en `3515` por defecto en PM2; `deploy/pinosoluciones.nginx.conf` ya apunta a ese puerto. Si se cambia, actualizar ambos valores.

`output: "standalone"` no copia `public/` ni `.next/static` dentro de `.next/standalone`; de eso se encarga el `postbuild` (`scripts/postbuild-standalone.mjs`), que además enlaza el `.env`. Si se saltea, el sitio responde 200 pero sirve el HTML sin CSS ni imagenes.

`deploy/traefik-pinosoluciones.yml` y `deploy/nginx.conf.example` sirven solo para un servidor donde el 443 lo atienda Traefik (era el caso del VPS anterior). En ese caso no se usa Certbot.

### Actualizar producción

Antes de un deploy que toque datos, hacer un backup (ver abajo). Después:

```bash
cd /var/www/pino-soluciones
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm build
pm2 reload ecosystem.config.cjs --update-env
```

Si la versión trae una migración de datos, va después del build y antes del reload. Hacé primero el backup y corré cada migración en modo prueba:

- `pnpm migrate:purchases`: pasa las compras al circuito nuevo. Las solicitudes viejas toman número SC-n y el número anterior queda en `legacyNumber`. Los estados se pasan a los nuevos, las OP de facturas de una OC se atan a la OC y se recalcula lo pagado de cada OC. Sin `--apply` solo cuenta lo que haría.
- `pnpm migrate:cash-accounts`: arma el maestro de cajas y cuentas bancarias con los nombres que se escribían a mano en caja, recibos y pagos. Sin `--apply` solo muestra cómo agruparía los nombres. Si dos nombres distintos son la misma cuenta, se unen con un mapa JSON (`--map mapa.json`, con `{ "como se escribió": "nombre de la cuenta" }`). Con `--apply` crea las cuentas y ata cada movimiento a la suya. Después, en Tesorería › Cajas y cuentas bancarias, hay que revisar la empresa, el tipo, el banco y el saldo inicial de cada cuenta.
- `pnpm cash:codes`: carga el maestro de cajas y cuentas con los códigos acordados con Administración (`scripts/load-cash-accounts.ts`). A las cuentas que ya existen les completa el código, la empresa, el tipo y la moneda, sin cambiarles el nombre. Las reconoce por código o por nombre; si alguna se llama distinto, se pasa en un mapa JSON (`--map mapa.json`, con `{ "nombre actual": código }`). Las que faltan las da de alta y ata cada cuenta de cheques diferidos a su banco. Las que ya había y no están en la lista se muestran y no se tocan. Sin `--apply` solo muestra lo que haría.
- `pnpm migrate:party-codes`: les pone código a los proveedores y clientes que no tienen, por fecha de alta (los nuevos ya lo reciben solos). Sin `--apply` solo cuenta.
- `pnpm parties:import /ruta/listado.xlsx --proveedores` (o `--clientes`): carga el listado exportado de TANGO (razón social —columna "Razón social", "Proveedor" o "Cliente"—, nombre de fantasía, CUIT/CUIL y, si vienen, domicilio y correo). Busca cada renglón por CUIT y, si no lo encuentra, por razón social: al que existe le completa lo que falta (`--overwrite` pisa lo cargado) y el que no está lo da de alta con su código. El renglón sin CUIT también se carga; si trae DNI, queda en las notas (ARCA factura con CUIT). Avisa los CUIT con el dígito verificador mal y los repetidos. Los códigos de TANGO no se usan. Sin `--apply` solo muestra lo que haría.
- `pnpm migrate:heic`: pasa a JPEG las fotos HEIC que se subieron antes con extensión de imagen y se veían rotas. Las convierte en el lugar, con el mismo nombre, y guarda el original en `/var/lib/pinos/heic-originales`. Sin `--apply` solo las lista.
- `pnpm stock:galpon /ruta/planilla.xlsx`: carga un inventario del Galpón desde una planilla con las columnas ARTICULO, COD. BARRA y CANTIDAD. Cada renglón es un ajuste (fija lo contado y queda en los movimientos y en la bitácora); el material se busca por código de barras o por nombre y, si no está, se da de alta. Lo que suma queda a nombre de TVP (`--owner constructora` para la otra empresa) y `--zero-missing` pone en cero lo que hoy está en el Galpón y la planilla no nombra. Sin `--apply` solo muestra lo que haría.
- `pnpm exec tsx --env-file=.env scripts/migrate-protex-consumer.ts --file /ruta/lista.xlsx`: completa los precios finales de los 211 productos de la lista vigente de Protex y ajusta su vigencia al 01/09/2026. Primero ejecutarlo sin `--apply`; luego repetirlo con `--apply`.

## Factura electrónica (ARCA)

Cada empresa (Constructora Pino y Trabajos Verticales Pino) entra a los web services de ARCA con su propio certificado. En Configuración › Empresas y comprobantes, "Probar conexión" trae los puntos de venta de web services y el último número de cada comprobante. Solo consulta: no emite nada.

- `ARCA_CERT_DIR`: carpeta **fuera del repo** (que es público) con `<empresa>.crt` y `<empresa>.key`, es decir `constructora.*` y `tvp.*`. Sin los dos archivos, la empresa figura como no conectada.
- `ARCA_ENV`: `produccion` (por defecto) u `homologacion`, el ambiente de prueba, que necesita certificados emitidos ahí.
- El servidor tiene que tener `openssl` (firma el pedido de acceso).

Alta del certificado de una empresa, con la clave fiscal de esa empresa:

1. Generar la clave y el pedido (CSR), con el CUIT sin guiones:

   ```bash
   openssl genrsa -out tvp.key 2048
   openssl req -new -key tvp.key -subj "/C=AR/O=TRABAJOS VERTICALES PINO S.A.S./CN=pinosoluciones/serialNumber=CUIT 30716295636" -out tvp.csr
   ```

2. En ARCA, "Administración de Certificados Digitales": agregar el alias `pinosoluciones`, subir el `.csr` y descargar el certificado como `<empresa>.crt`.
3. En "Administrador de Relaciones de Clave Fiscal": nueva relación con el servicio "Facturación Electrónica" (WSFE) y, como representante, el computador fiscal `pinosoluciones`.
4. En "Administración de puntos de venta y domicilios": la empresa necesita un punto de venta de tipo "RECE / Factura electrónica - Web Services". Los de Factuweb o Controlador fiscal no sirven.
5. Copiar `.crt` y `.key` a `ARCA_CERT_DIR` en el servidor (solo lectura para el usuario que corre PM2) y probar la conexión desde Configuración.

ARCA da un ticket de acceso que dura 12 horas y no entrega otro para el mismo certificado mientras siga vigente. El sistema lo guarda en la base (colección `arcatickets`) y lo reusa. Si se prueba primero desde otra máquina con el mismo certificado (por ejemplo, en local), producción no puede entrar hasta que ese ticket venza.

## Factura electrónica (ARCA)

El sistema se conecta con ARCA por web services (WSAA + WSFEv1) con un certificado por empresa:

- En ARCA, cada empresa tiene el alias `pinosoluciones` en *Administración de Certificados Digitales*, autorizado para el WebService *Facturación Electrónica* en el *Administrador de Relaciones*. Los certificados que usa Tango son otros y no se tocan.
- La clave privada se genera fuera de ARCA (`openssl genrsa` + `openssl req` con `serialNumber=CUIT <cuit>` y `CN=pinosoluciones`); a ARCA se sube solo el `.csr`.
- En el servidor, el `.crt` y la `.key` van en `/etc/pinos/arca/` como `constructora.crt`/`.key` y `tvp.crt`/`.key` (dueño root, permisos 600), y el `.env` tiene `ARCA_CERT_DIR=/etc/pinos/arca` y `ARCA_ENV=produccion`. Nunca en el repo.
- El ticket de acceso dura 12 horas y se guarda en la colección `arcatickets`: ARCA no entrega otro mientras esté vigente.
- Para probar la conexión: Configuración › Empresas y comprobantes › "Probar conexión" en cada empresa. Solo consulta (puntos de venta, último número de cada comprobante y por qué punto de venta se emite cada tipo): no emite nada.
- Emisión: en Facturas de venta, un comprobante nuevo de una empresa conectada (Factura, Nota de Débito o Nota de Crédito, A o B) se emite al guardar ("Emitir ahora en ARCA (con CAE)"): ARCA pone el número y el CAE. El número aparece bloqueado con el que sigue en ARCA (último autorizado + 1, `/api/arca/next`); "Editar" lo libera, pero al emitir tiene que coincidir con el de ARCA. También se puede elegir "Ya la emití en Tango" y cargar el número a mano. El punto de venta es el del talonario habilitado de ese tipo (Configuración › Empresas y comprobantes) que ARCA tiene de alta para web services; sin ese talonario no se emite.
- La condición frente al IVA del cliente va en su ficha; sin cargar, la A se emite a responsable inscripto y la B a consumidor final. Concepto: productos si factura remitos, servicios si no (con el mes de la factura como período).
- Las notas de débito y crédito van asociadas a una factura (o nota de débito) del mismo cliente, empresa y letra, y usan el talonario y punto de venta de la factura de su letra. La nota de crédito resta: descuenta de lo que se debe de la factura asociada (queda "aplicada", no puede ser por más de ese saldo) y resta en tablero, reportes, seguimiento y libro IVA.
- Un comprobante con CAE no se borra, no se anula y no cambia cliente, fecha, número ni importes: una factura se anula con una nota de crédito. Una factura con notas asociadas no se borra. Su PDF, con CAE y QR, sale del botón "PDF fiscal" de la lista.
- El servidor de WSFEv1 ofrece primero Diffie-Hellman de 1024 bits, que Node rechaza; `src/lib/arca.ts` pide solo cifrados ECDHE con AES-GCM o ChaCha20.

## Circuito de compras

Requerimiento integral v4, con lo acordado en el grupo de PINO (`src/lib/purchase-flow.ts`):

1. **Compras** arma la solicitud (`SC-n`) con su condición de compra (contado en efectivo o por transferencia, cuenta corriente o a plazo con los días) y la emite. Desde ahí queda en sólo lectura y solo Gerencia la anula, con motivo.
   El total no se escribe: sale del neto, el **IVA de cada renglón** (21 %, 10,5 % o 27 %; si el renglón no dice, el de la solicitud), las **percepciones** de IVA, de IIBB e IIBB provincial y el **impuesto interno**, cada uno con su porcentaje sobre el neto (`src/lib/purchase-taxes.ts`). La cargada a mano se carga por el neto. Ver `docs/decisiones/2026-10-impuestos-solicitud-compra.md`.
2. **Por debajo de $500.000** queda autorizada sola. **Desde $500.000** (inclusive, sobre el total con impuestos) la autoriza Gerencia o quien tenga el permiso "Autorizar compras" (Configuración › Usuarios, por persona). El límite está en `PURCHASE_APPROVAL_LIMIT_CENTS`.
3. **Al autorizarse nace la OC** (`OC-n`, atada a la solicitud). Compras recibe el aviso para pedirle al proveedor y Tesorería el de qué viene a pagar (de contado, con el medio, o con la factura). La OC copia los impuestos de la solicitud y su PDF muestra el IVA de cada renglón, el de cada alícuota, las percepciones y el impuesto interno. También copia la **cotización de venta** para la que se compra (`quoteNumber`), que se ve en la ficha y en el PDF aunque la compra no tenga obra. Una solicitud autorizada antes de este cambio, sin OC, la recibe con su primera OP.
   Tesorería puede emitir desde la ficha de la compra una OP **de contado o anticipo** contra la OC, sin factura: se paga en el momento (caja del maestro y comprobante) o queda emitida con su vencimiento. Una OC admite varias OP parciales y guarda lo pagado (`paidCents`, `paymentStatus`). Las OP las emiten solo Gerencia y Administración, aunque un usuario de Compras tenga guardado el permiso de antes.
4. **Compras** carga los remitos del proveedor, sin esperar ninguna OP (Compras › Remitos de compra, `PurchaseReceipt`). Pueden ser parciales y suman al stock; el remito final cierra la OC.
5. **Facturas de compra:** Compras carga las de compras menores al límite; desde el límite, Tesorería. Además de Factura A, C y X se cargan las **notas de débito y de crédito** del proveedor (A y C), con la factura que corrigen si se sabe.
   Con el neto cargado, el total sale del neto, el IVA (sólo en la A y sus notas: 21 %, 10,5 %, 27 % o exento), las **percepciones** de IVA, de IIBB e IIBB provincial y el **impuesto interno**. "Cargar factura" desde la OC la abre con el neto, la alícuota y los porcentajes de la OC. El **libro IVA compras** muestra cada percepción y el impuesto interno en su columna.
   La factura **elige los remitos de su OC** (`purchaseReceiptIds`; una nueva arranca con los que no están en otra factura) y avisa si el neto pasa lo recibido a precio de la OC. Ver `docs/decisiones/2026-10-remitos-y-cotizacion-en-compras.md`.
6. **Orden de pago de facturas** (Tesorería › Órdenes de pago › Nueva, `src/lib/payment-order-service.ts`): se elige el proveedor y aparecen sus facturas y notas de débito con saldo y sus notas de crédito. De cada factura se paga el total o una parte (lo que queda vuelve a aparecer en la próxima OP) y las notas de crédito restan. La OP guarda cuánto aplica a cada comprobante (`Payment.allocations`); lo que está en otra OP emitida no se puede volver a pagar. Lleva el tipo de gasto (cuenta del plan), la obra y con qué se paga: uno o varios medios, cada uno de su caja o cuenta (ver "Medios de pago, cheques y extracto"). No lleva retenciones: la empresa no es agente de retención.
7. **Lo pagado contra la OC cubre sus facturas.** Una OP de contado o anticipo contra la OC (sin factura) se aplica sola a las facturas de esa OC cuando llegan, la más vieja primero (`Expense.advanceCents`): no vuelven a aparecer para pagar ni se cuentan dos veces en lo pagado de la OC.
8. **Obra según el tipo de gasto:** un GGI o un bien de uso (BB) no va a una obra ni la hereda de la OC. CC y GGD pueden ir con obra o sin ella (una compra para el depósito todavía no es de ninguna obra).

## Papeles de compras y adjuntos

- **Adjuntos con historial** (`src/lib/attachments.ts`, `/api/files/[entity]/[id]`): en solicitudes y órdenes de compra, órdenes de pago, facturas de compra, movimientos de caja y remitos de compra. Cada archivo guarda su nombre original, quién lo subió y cuándo. No se borra: reemplazarlo deja el anterior en el historial, con quién y cuándo lo reemplazó. El archivo único de antes (`attachment`) se muestra como el primero.
- **Orden de pago en PDF** (`src/lib/payment-order-pdf.ts`): proveedor, qué paga (OC, solicitud, factura o el detalle de facturas con lo que se paga de cada una y las notas de crédito descontadas), importe en letras, cada medio con su cuenta e importe (y el cheque o e-Cheq), tipo de gasto y obra. Si algún medio es efectivo, trae la constancia de entrega para firmar; la firmada se sube como adjunto de la OP.
- **"OC con adjuntos"** (`src/lib/purchase-dossier.ts`, con `pdf-lib`): un solo PDF con la orden y sus adjuntos PDF y fotos. Lo que no se puede convertir (Excel, DWG) se lista en una hoja al final.
- **Expediente ZIP** (con `fflate`): solicitud, orden, órdenes de pago, comprobantes, remitos, facturas y adjuntos, por carpeta y con un índice.
- Las tres cosas se arman en el navegador, desde la ficha de la compra.

## Cajas y cuentas bancarias

Tesorería › Cajas y cuentas bancarias es el maestro (`cashAccounts`): código, empresa titular, nombre, tipo, banco, moneda, CBU/alias, estado y saldo inicial con su fecha de corte.

- Cada cuenta tiene un código numérico, como en TANGO, que no se repite. Los rangos van por empresa: 1–5 cajas de Constructora, 6–9 cajas de Verticales, 10–19 bancos de Constructora, 20–29 cheques diferidos de Constructora, 30–39 bancos de Verticales, 40–49 cheques diferidos de Verticales, 50–59 cajas de las dos empresas, 60–69 otras de Constructora y 70–79 otras de Verticales. En cualquier selector de caja se escribe el código y Enter. Ver `docs/decisiones/2026-10-cajas-con-codigo.md`.
- Una cuenta puede ser de las dos empresas (`company: "ambas"`): la caja de efectivo, las de moneda extranjera (dólares, reales, euros) y la del Salón de Ventas. Sirve para movimientos de cualquiera de las dos. En un pase toma la empresa de la otra cuenta.
- La cuenta de cheques diferidos de cada banco guarda el banco que los debita (`bankAccountId`).
- Cada movimiento de caja, recibo y pago elige una cuenta activa del maestro, de su misma empresa o de las dos (`cashAccountId`; en `account` queda el nombre). Ya no se crea una cuenta escribiendo un nombre nuevo. Una planilla importada puede traer el nombre de una cuenta que ya existe.
- El nombre no se repite aunque se escriba distinto (`nameKey`). Una cuenta usada no se borra: se inactiva. El saldo inicial y la fecha de corte los cambia sólo Gerencia.
- El saldo de cada cuenta se calcula como el inicial, más lo que entró y menos lo que salió desde la fecha de corte.
- El pase entre cuentas propias elige el origen y el destino del maestro. En Movimientos por cuenta aparece, pero no suma a los ingresos ni a los egresos.

## Medios de pago, cheques y extracto

Anexo de Tesorería v5.1, validado con Administración. Las decisiones están en `docs/decisiones/2026-10-cajas-con-codigo.md`.

- **La OP y el recibo pueden tener varios medios** (`lines`): transferencia, efectivo, cheque, e-Cheq, cheque de terceros (solo en la OP), tarjeta y otro. Cada medio va con su caja o cuenta, que tiene que ser del tipo que corresponde y de la empresa del documento o de las dos (`accountTypesFor`, `src/lib/cash-methods.ts`). Para pagar, los medios suman el importe de la OP. La transferencia, el cheque y el e-Cheq llevan su comprobante. Lo de antes, con un solo medio, se lee igual como una línea (`paymentLines` y `collectionLines`, en `src/lib/balances.ts`). Los saldos, Movimientos por cuenta y los PDF van por medio.
- **Cheque propio** (`src/lib/payment-checks.ts`): siempre diferido. Sale de la cuenta de cheques diferidos de su banco; si se elige el banco, se toma la suya. El cheque queda emitido en Tesorería › Cheques. Cuando el banco lo debita, el botón **Debitar** registra la "Transferencia de cheque diferido al banco": un pase del banco a la de cheques diferidos, y recién ahí baja el banco (`src/lib/check-service.ts`).
- **Cheque de terceros**: entra con el recibo a Valores al Cobro y queda en cartera. En la OP se endosa entero; si la OP se anula o lo suelta, vuelve a la cartera. **Depositar** hace el pase de Valores al Cobro al banco. Un recibo con un cheque ya endosado o depositado no se borra.
- **Recibo**: lo cobrado más las retenciones que hizo el cliente (Ganancias, IIBB, IVA, SUSS, otros; con jurisdicción y número de certificado) es lo que se aplica a las facturas. Las retenciones van a la cuenta de retenciones de la empresa.
- **Tarjeta**: una sola cuenta por empresa. En la OP es la tarjeta corporativa; el resumen que debita el banco es un pase del banco a la tarjeta. En el recibo es el posnet; cuando acredita, es un pase de la tarjeta al banco.
- **Período de la factura** (`period`, "2026-10"): toma el mes de la fecha salvo que se ponga otro, y sigue a la fecha si cambia. El libro IVA va por período; lo de antes, sin período, va por fecha.
- **Extracto por caja** (Tesorería › Extracto por caja, `src/lib/cash-statement.ts`): de un código a otro y entre dos fechas. Muestra el saldo anterior, cada movimiento (período, fecha, detalle, concepto, débito = sale, crédito = entra) y el saldo final, y se exporta a Excel. Un pago o cobro de varias facturas sale en una fila por factura, con su período.
- **Proveedores y clientes** tienen código (lo pone el sistema) y nombre de fantasía. En los selectores se buscan por código, razón social, fantasía o CUIT, con o sin guiones.

## Facturación parcial

Lo cotizado contra lo facturado se mide en **neto** (sin IVA): ver `docs/decisiones/2026-10-certificado-sobre-neto.md`.

- La cotización guarda su neto (`netCents`: el subtotal 3 de la cascada, o importe / 1,21 si se cargó a mano) y la obra su presupuesto neto (`budgetNetCents`). El certificado es un porcentaje de ese neto: lo calcula el servidor, que no deja pasar del 100 %.
- Adicionales y reducciones: en el detalle de la cotización, panel "Facturación" (`/api/quotes/[id]/adjustments`). Cambian lo cotizado vigente sin tocar la cotización original.
- Cotizado vigente, facturado (− notas de crédito + notas de débito), pendiente total, habilitado para facturar (certificados aprobados y remitos sin facturar), % y estado: `src/lib/quote-billing.ts`, en el panel de la cotización y en Seguimiento.
- Al guardar una factura, el servidor la frena si pasa de lo pendiente de su cotización, de su certificado o de lo elegido de sus remitos (`checkInvoiceExcess`). Gerencia la puede guardar igual con un motivo, que queda en el historial de la cotización.
- Un remito de venta se puede facturar en partes: cada renglón lleva `invoicedQty` y la factura `remitoLines`. Al anular o borrar la factura, vuelve lo que facturaba.

## Entradas por la Caja

- Stock y logística › Caja › Entrada: empresa que compró (**TV Pino / Galpón** o **Constructora Pino / Salón de Ventas**), fecha, observaciones y los materiales. Se escanean o se cargan **ítem por ítem** (producto, cantidad, unidad, costo y rubro): si el producto ya está en Stock se suma a lo que hay; si no, se da de alta al confirmar. Proveedor y comprobante son opcionales. Todo entra junto con un comprobante `CJ-n` y una orden de compra recibida.

## Salidas a obra

- **Carrito para obra** (`src/lib/work-cart.ts`): en Stock y logística › Stock, cada material tiene el botón "Carrito" con su cantidad. La barra de abajo muestra lo que se lleva y el costo aproximado. "Hacer salida a obra" abre la Caja con el carrito cargado: se elige la obra y se confirma todo junto, con un comprobante `CJ-n` y un remito por depósito. Al confirmar, el carrito se vacía. El carrito vive en el navegador de quien lo arma.
- **Registro** (Stock y logística › Salidas a obra, `/app/salidas`): todas las salidas de la Caja, filtradas por obra y fechas, con el costo total cargado a la obra y exportación a Excel. Desde la obra, el botón "Material entregado" abre el listado filtrado.
- **PDF con costos** (`src/lib/salida-pdf.ts`): el detalle de la salida con el costo unitario (promedio ponderado) y el subtotal de cada material, el total cargado a la obra, los remitos y las firmas. Es un papel interno: el remito que acompaña al material no lleva precios.

## Backups

En producción el host no tiene `mongodump`, porque Mongo corre en Docker, así que `deploy/backup.sh` no funciona tal cual. Backup manual:

```bash
cd /var/www/pino-soluciones && set -a && . ./.env && set +a
STAMP=$(date +%Y-%m-%d_%H-%M-%S); mkdir -p /var/backups/pinos/$STAMP
docker exec mongodb mongodump --uri="$MONGODB_URI" --archive --gzip > /var/backups/pinos/$STAMP/mongodb.archive.gz
tar -czf /var/backups/pinos/$STAMP/uploads.tar.gz -C /var/lib/pinos uploads
```

Hoy no hay backup automático programado. Para producción se recomienda programarlo diariamente y copiar cada backup cifrado a otro servidor o almacenamiento S3 compatible.

En un servidor con MongoDB Database Tools instalados, `deploy/backup.sh` sí sirve: darle permiso de ejecución, cargar las variables de `.env` y programarlo con cron. Mantiene 14 días localmente.

La restauración es destructiva y debe probarse primero en una base separada:

```bash
./deploy/restore.sh /var/backups/pinos/AAAA-MM-DD_HH-MM-SS
```

## Importación

Cada módulo acepta `.xlsx` o `.csv` de hasta 2.000 filas y 5 MB. La primera fila debe usar las claves técnicas visibles en `src/lib/entity-config.ts` (por ejemplo `name`, `phone`, `amountCents`). Las columnas monetarias se ingresan en pesos y se convierten internamente a centavos. Los errores se aíslan por fila.

Las listas de precios de proveedores se cargan aparte, desde la ficha del proveedor: aceptan `.xlsx` de hasta 10 MB y muestran una vista previa antes de guardar. El formato de Protex sin títulos toma el precio de lista de la columna F y el precio final al consumidor, con IVA, de la K. El descuento acordado se configura en la ficha y se aplica al mostrar “Tu precio”, que sigue siendo el costo de compra. Si la planilla informa el precio final al consumidor, el buscador lo muestra en una columna aparte; el selector de IVA permite verlo con o sin impuesto.

## Seguridad y operación

- Sesiones HTTP-only de ocho horas y contraseñas con bcrypt.
- Permisos por rol validados tanto en interfaz como en API.
- Auditoría de altas, cambios, bajas e importaciones.
- El worker genera tareas por facturas y cheques próximos a vencer.
- Bitácora completa (usuario, fecha y hora, valor anterior y nuevo) en Seguridad › Bitácora de cambios, solo para gerencia.
- Todo ingreso y egreso de plata (caja y bancos, recibos, pagos) se imputa a una cuenta del plan de cuentas. El catálogo y los talonarios de comprobantes se crean solos la primera vez; no hace falta correr nada al actualizar.
- Una orden de compra entra al depósito que pide (Galpón o Salón de Ventas). En la Caja, la empresa que compró define el depósito: TV Pino entra al Galpón y Constructora Pino al Salón de Ventas (`ENTRY_WAREHOUSE` en `src/lib/warehouses.ts`). La entrada manual desde la ficha de un material sigue la misma regla. Entre depósitos el material pasa por transferencia (queda en tránsito hasta que se confirma la recepción).
- Para actualizar producción: ver [Actualizar producción](#actualizar-producción).
- Comandos de calidad: `pnpm lint`, `pnpm test`, `pnpm build`.
