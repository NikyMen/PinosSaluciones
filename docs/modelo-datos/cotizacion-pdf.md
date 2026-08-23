# Cotización — PDF al cliente

**Fuente:** `_inbox/UNIDAD POLIUREA CALIENTE.pdf` (salida de Tango) + pestaña `Precio` de las planillas.

Es el documento que **sí** ve el cliente. Todo el costeo del [[cotizador-cascada]] queda del lado interno.

## Estructura

**1. Encabezado**
- Membrete y logo de la empresa emisora — *"cambia el encabezado nomás"* entre Constructora y Verticales
- `COTIZACION Nº` (`000010000101`), lugar y fecha (`Corrientes, 15/05/2026`)
- Cliente: código interno (`000417`), razón social, **CUIT**, dirección

**2. Texto de presentación**
- Fórmula de cortesía
- Moneda y **validez**: *"Precios y condiciones válidos hasta 12/09/2026"* → alimenta el vencimiento automático

**3. Memoria descriptiva**
- `Objeto de la obra`
- `Descripción de los trabajos` — pasos numerados con texto largo (preparación de superficie, imprimación, impermeabilización, terminación)
- `Notas` y condicionantes técnicos
- **Responsabilidades del cliente** — ej. *"el cliente será responsable de retirar el cielorraso"*
- `Plazo estimado de ejecución`
- `Forma de pago` — ej. *"50 % de anticipo a la aprobación, saldo a 30 y 60 días"*

Todo esto es texto largo y reutilizable por tipo de trabajo. Candidato claro a **plantillas de servicio**.

**4. Tabla de ítems**

| Campo | Ejemplo |
|---|---|
| Código de artículo | `550045` |
| Descripción | `POLIUREA EN CALIENTE` |
| Cantidad / unidades | `1300` |
| Precio lista | `84.000,00` |
| % descuento | `21 %` |
| Precio unitario | |
| Importe | `109.200.000,00` |

Admite líneas de ajuste con importe negativo (`RECONOCIMIENTO … −34.580.000,00`).

**5. Totales**
```
Subtotal del Pedido      58.949.800
Bonificación
Subtotal Neto            58.949.800
IVA 21,00 %              15.670.200
Total                    74.620.000
```
Más el **importe en letras**: *"SON PESOS SETENTA Y CUATRO MILLONES SEISCIENTOS VEINTE MIL"*.

## Consecuencias de diseño

1. `clients` necesita **CUIT** y **código de cliente**.
2. La cotización necesita **ítems con código de artículo** enlazados al catálogo de productos ([[../requerimientos/stock]]).
3. Precio lista + % de descuento por línea, además del descuento especial global.
4. Neto / IVA / Total desagregados — hoy `quotes` guarda un único `amountCents`.
5. Importe en letras en el PDF.
6. La memoria descriptiva es texto largo por ítem, no un `description` corto.
7. Validez → estado `vencida` automático.
