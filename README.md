# Pinos Soluciones — ERP/CRM

Sistema web para centralizar clientes, ventas, obras, proveedores, gastos, facturación administrativa, cobranzas, pagos, cheques, tareas y reportes. No emite comprobantes fiscales ni se conecta con ARCA.

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
En el VPS se puede usar `/opt/pinos/.env`; también funcionan variables de entorno exportadas por el proceso.

Para cargar datos ficticios de Corrientes sin borrar ni sobrescribir registros existentes:

```bash
pnpm seed:demo
```

Abrir `http://localhost:3000` (o el puerto que informe Next, por ejemplo `3001`) e ingresar con `ADMIN_EMAIL` / `ADMIN_PASSWORD` definidos en `.env`.

## Despliegue en VPS

1. Instalar Node LTS, pnpm, MongoDB Database Tools, Nginx y PM2 (`pnpm add -g pm2`).
2. Crear un usuario Linux exclusivo y clonar el repositorio en `/opt/pinos`.
3. Crear `/opt/pinos/.env` desde `.env.example` y reemplazar `MONGODB_URI` por la URI de la base que ya existe en el VPS. Usar una `SESSION_SECRET` aleatoria y `APP_URL=https://tu-dominio`. MongoDB debe escuchar solo en localhost o una red privada autenticada.
4. Crear el directorio persistente: `sudo install -d -o pinos -g pinos /var/lib/pinos/uploads /var/log/pinos /var/backups/pinos`.
5. Ejecutar:

```bash
cd /opt/pinos
pnpm install --frozen-lockfile
pnpm db:check
pnpm seed
# Opcional: solo para una instalacion de demostracion
pnpm seed:demo
pnpm build
cp -r public .next/standalone/
mkdir -p .next/standalone/.next
cp -r .next/static .next/standalone/.next/
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

6. Publicar el dominio. En el VPS actual el puerto 443 lo termina Traefik (container `n8n-traefik-1`), no Nginx: copiar `deploy/traefik-pinosoluciones.yml` a `/docker/n8n/dynamic/` (Traefik lo toma solo, sin reiniciar nada) y dejar en Nginx solo el `:80` que redirige, como en `deploy/nginx.conf.example`. El certificado lo emite Traefik por TLS-ALPN-01 en el primer request HTTPS, asi que el dominio ya tiene que resolver a la IP del VPS. **No usar Certbot aca**: emitiria un certificado que nadie sirve, porque Nginx no puede escuchar en el 443.
7. Verificar `https://dominio/api/health` y `pm2 status`.

El proceso web escucha en `3515` por defecto en PM2; `deploy/traefik-pinosoluciones.yml` ya apunta a ese puerto. Si se cambia, actualizar ambos valores.

`output: "standalone"` no copia `public/` ni `.next/static` dentro de `.next/standalone`: los tres `cp` del paso 5 hay que repetirlos **despues de cada `pnpm build`**. Si se saltean, el sitio responde 200 pero sirve el HTML sin CSS ni imagenes.

## Backups

Dar permiso de ejecución a `deploy/backup.sh`, cargar las variables de `.env` y programarlo diariamente con cron. Mantiene 14 días localmente. Para producción se recomienda copiar cada backup cifrado a otro servidor o almacenamiento S3 compatible.

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
- Para actualizar: `pnpm install --frozen-lockfile && pnpm build && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && pnpm pm2:reload`.
- Comandos de calidad: `pnpm lint`, `pnpm test`, `pnpm build`.
