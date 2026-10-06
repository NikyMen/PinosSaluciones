# Pinos Soluciones — ERP/CRM

Sistema web para centralizar clientes, ventas, obras, proveedores, gastos, facturación administrativa, cobranzas, pagos, cheques, tareas y reportes. Todavía no emite comprobantes fiscales: las Factura A y B se emiten en Tango y se cargan acá (la conexión con ARCA, por ahora, solo consulta; ver [Factura electrónica (ARCA)](#factura-electrónica-arca)); el comprobante interno X se numera en el sistema y queda fuera del libro IVA.

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
- Los archivos subidos van a `/var/lib/pinos/uploads` (`UPLOAD_DIR`).
- PM2 está instalado con pnpm global y en una sesión SSH sin terminal interactiva no está en el `PATH`: usar `/root/.local/share/pnpm/bin/pm2` o hacer antes `export PATH=/root/.local/share/pnpm:$PATH`.

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
- Para probar: Configuración › Empresas y comprobantes › "Probar conexión" en cada empresa. Solo consulta (puntos de venta y último número de cada comprobante): no emite nada.
- El servidor de WSFEv1 ofrece primero Diffie-Hellman de 1024 bits, que Node rechaza; `src/lib/arca.ts` pide solo cifrados ECDHE con AES-GCM o ChaCha20.

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

## Seguridad y operación

- Sesiones HTTP-only de ocho horas y contraseñas con bcrypt.
- Permisos por rol validados tanto en interfaz como en API.
- Auditoría de altas, cambios, bajas e importaciones.
- El worker genera tareas por facturas y cheques próximos a vencer.
- Bitácora completa (usuario, fecha y hora, valor anterior y nuevo) en Seguridad › Bitácora de cambios, solo para gerencia.
- Todo ingreso y egreso de plata (caja y bancos, recibos, pagos) se imputa a una cuenta del plan de cuentas. El catálogo y los talonarios de comprobantes se crean solos la primera vez; no hace falta correr nada al actualizar.
- Toda compra entra al Depósito Central; al Salón de Ventas el material llega por transferencia (queda en tránsito hasta que se confirma la recepción).
- Para actualizar producción: ver [Actualizar producción](#actualizar-producción).
- Comandos de calidad: `pnpm lint`, `pnpm test`, `pnpm build`.
