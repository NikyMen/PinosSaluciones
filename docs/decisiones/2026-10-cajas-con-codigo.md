# Anexo de Tesorería v5.1: cajas con código, varios medios, cheques, retenciones y extracto

- **Fecha:** 2026-10-30
- **Estado:** aceptada y hecha. Validada con Administración por WhatsApp (28 y 30/10/2026) y por la encuesta de consultoriadigital.io (31/10/2026).
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

## Orden de pago con varios medios

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

- La OP **no lleva retenciones**: la empresa no es agente de retención (encuesta). Algunos proveedores
  facturan con percepciones de IVA, IIBB y otros impuestos: van en su factura de compra.
- Siempre en pesos: la OP no pide cotización.

Cómo quedó: `Payment.lines` (`src/lib/payment-order-service.ts`, `src/lib/payment-checks.ts`). Cada
medio usa una cuenta de su tipo (`accountTypesFor`, `src/lib/cash-methods.ts`). El cheque propio
sale de la cuenta de cheques diferidos de su banco y **Debitar**, en Tesorería › Cheques, registra el
pase al banco (`src/lib/check-service.ts`). Una OP de antes, con un solo medio, se lee como una línea.

## Recibo con varios medios y retenciones

- Lo cobrado (transferencia, cheque, efectivo, posnet…) más las retenciones que hizo el cliente es el
  total de la factura (encuesta). Las retenciones son de Ganancias, IIBB, IVA, SUSS y otros impuestos
  provinciales (Buenos Aires, Chaco); llevan jurisdicción y número de certificado, y van a la cuenta de
  retenciones de la empresa (`Collection.retentions`).
- El cheque o e-Cheq del recibo entra a Valores al Cobro, en cartera. Un recibo con un cheque ya
  endosado o depositado no se borra ni puede sacarlo.

## Tarjetas y posnet

- **Una sola cuenta de tarjeta por empresa** (61 y 71), como la usa Administración: se usa para la
  tarjeta corporativa (pagos en la OP) y para el posnet (cobros).
- La tarjeta corporativa se debita de Verticales Cuenta 2, cinco días hábiles después del cierre
  (~25), entre el 1 y el 3 de cada mes: es un pase del banco a la tarjeta.
- Posnet: Constructora tiene los dos en el Banco Corrientes; Verticales, uno en Corrientes y otro en
  Santander. Se cobra con un recibo a la tarjeta por el total facturado y, cuando acredita, se hace el
  pase de la tarjeta al banco (encuesta).

## Período y extracto por caja

- **Período de la factura**: el mes de la factura, también para el IVA. Por ejemplo, una factura del
  29/10 cargada el 02/11 va a octubre (encuesta). `period` toma el mes de la fecha salvo que se ponga
  otro, y el libro IVA va por período.
- **Extracto por caja**: Administración lo descarga de una caja o de un rango de códigos, por semana,
  mes o varios meses. Muestra el saldo anterior, los movimientos con Cuenta, Período, Fecha, Detalle,
  Concepto, Débito (sale) y Crédito (entra), y el saldo final. Un pago o cobro de varias facturas sale
  en una fila por factura, con su período (`src/lib/cash-statement.ts`).

## Proveedores y clientes

- El buscador por código, razón social, nombre de fantasía y CUIT sirve para proveedores y clientes
  (encuesta). El sistema numera solo: no se mantienen los códigos de TANGO.
- Administración exporta de TANGO el listado de proveedores; se carga con `pnpm parties:import`.
- **Pendiente, aparte:** al dar de alta un proveedor o un cliente por CUIT, completar solos los datos
  (condición frente al IVA, tipo de factura, domicilio) desde el padrón de ARCA. Hace falta habilitar
  el servicio de padrón para el certificado.
