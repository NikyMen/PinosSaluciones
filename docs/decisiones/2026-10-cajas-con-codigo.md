# Cajas y cuentas con código, cajas de las dos empresas y el circuito de cheques

- **Fecha:** 2026-10-30
- **Estado:** aceptada (validada con Administración por WhatsApp el 28/10/2026). El maestro ya está hecho; la OP con varios medios y los cheques, pendientes.
- **Afecta a:** [[../requerimientos/especificacion-v1-5]], [[../modelo-datos/esquema-actual]], [[2026-10-orden-de-pago-varias-facturas]]

## Contexto

El anexo de Tesorería v5.1 ("Tesorería, medios de pago y búsquedas inspiradas en TANGO", 28/10/2026)
pide cuatro cosas: una OP con varios medios de pago, un buscador de cajas y cuentas como el de TANGO
(F7), las retenciones sólo en los recibos y un buscador de proveedores. Lo fuimos validando con
Administración punto por punto. Esta decisión cubre el punto 1 y el maestro de cajas, que es su base.

Hasta acá cada caja o cuenta era de una sola empresa, no tenía código y la moneda era pesos o dólares.

## Decisiones

**Cada cuenta tiene un código numérico, como en TANGO.** Administración no pidió respetar los
números de TANGO, pero sí rangos por empresa, para poder sumar cuentas sin desordenar:

| Rango | Qué va |
|---|---|
| 1–5 | Cajas de Constructora |
| 6–9 | Cajas de Verticales |
| 10–19 | Bancos de Constructora |
| 20–29 | Cheques diferidos de Constructora |
| 30–39 | Bancos de Verticales |
| 40–49 | Cheques diferidos de Verticales |
| 50–59 | Cajas de las dos empresas |
| 60–69 | Otras de Constructora (valores al cobro, tarjeta, retenciones) |
| 70–79 | Otras de Verticales |

La cuenta de cheques diferidos de un banco termina en el mismo número que el banco (el 32 es Macro y
el 42 son sus cheques diferidos). El código no se repite. Los rangos son convención: el sistema no
los fuerza. En los selectores de caja se escribe el código y Enter; la lista del maestro va por código.
La carga inicial está en `scripts/load-cash-accounts.ts` (`pnpm cash:codes`).

**Hay cajas de las dos empresas.** Administración maneja una sola caja de efectivo para las dos, y
lo mismo pasa con las cajas de dólares, reales y euros y con la del Salón de Ventas.
`CashAccount.company` admite `"ambas"`: la cuenta sirve para un movimiento de cualquiera de las dos.
En un pase entre cuentas, la mitad de la caja compartida toma la empresa de la otra cuenta
(depositar el efectivo en el banco de Verticales es plata de Verticales). Si las dos son compartidas,
el pase queda sin empresa.

**Una caja por moneda.** Manejan dólares, reales y euros. Se separan en tres cajas para que cada
saldo quede en su moneda; sumar monedas distintas en una caja no da un número que sirva.

**Cuentas por empresa** (respuesta de Administración):
- Verticales: Banco Corrientes Sub-Cuenta 1 y Sub-Cuenta 2, Macro, Nación y Santander; Mercado Pago;
  Valores al Cobro; tarjeta de crédito; retenciones.
- Constructora: Banco Corrientes; Mercado Pago; Valores al Cobro; tarjeta de crédito; retenciones.
- Todas las cuentas bancarias emiten cheques, así que cada una tiene su cuenta de cheques diferidos,
  que guarda el banco que los debita (`bankAccountId`).

## Lo acordado para la OP (pendiente de programar)

- Una factura se paga total o en parte, con uno o varios medios a la vez: efectivo, transferencia,
  cheque propio, eCheq, cheque de terceros y tarjeta de crédito. Cada medio, con su caja o cuenta.
- El comprobante adjunto es obligatorio en cheque y transferencia, y opcional en el resto.
- **Cheque propio:** siempre diferido. Se le entrega al proveedor al generar la OP, pero el banco lo
  debita en la fecha de cobro (hasta 30 días después). Mientras tanto, el importe queda en la cuenta
  de cheques diferidos de ese banco. Cuando el banco lo debita, Tesorería busca el cheque por número y
  registra la "Transferencia de cheque diferido al banco" con la fecha. Desde el número de cheque se
  llega a la OP, el proveedor y la factura.
- **Cheque de terceros:** primero entra por el recibo de cobro (con el cliente y la cotización) y queda
  en Valores al Cobro, al día o diferido. Recién ahí se puede usar en una OP: sale de Valores al Cobro
  y queda endosado al proveedor. Si se deposita, es un pase de Valores al Cobro al banco.
- **Tarjeta de crédito de la empresa:** paga bienes de uso y compras en cuotas (patentes, una PC,
  cascos, cuerdas) y tiene débitos automáticos de los seguros de los vehículos. El resumen se debita
  del Banco Corrientes de Verticales, a veces de la Sub-Cuenta 1 y a veces de la 2.

## Pendiente

- Cobros con posnet (dos por empresa): se acreditan unos 20 días después, con descuentos del banco y
  la tarjeta. Va con el punto de cobranzas.
- Retenciones (punto 3 del anexo): piden sacarlas de la OP, pero TANGO tiene cuentas de "Retenciones
  … Practicadas", que son justamente las que se hacen al pagar. Hay que preguntarlo.
