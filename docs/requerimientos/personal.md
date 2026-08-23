# Personal y liquidación de jornales

**Módulo nuevo.** Vive dentro de [[administracion]].

Modelo de referencia: [[../modelo-datos/liquidacion-quincenal]] — está completamente decodificado.

| ID | Requerimiento | Prio |
|---|---|---|
| PER-1 | **Legajo de personal**: número, apellido y nombre, categoría, estado, domicilio, documento, CUIL, fecha de nacimiento, teléfono, alta y baja | P1 |
| PER-2 | **Valor del jornal** por tipo de trabajo, configurable | P1 |
| PER-3 | **Carga de horas** por persona, por día, por obra y por tipo de trabajo | P1 |
| PER-4 | **Liquidación quincenal**: filtrable por fechas, visualizable y exportable a PDF | P1 |
| PER-5 | **Deducciones**: adelantos, préstamos con cuotas, uniformes, embargos, ajustes de quincena anterior | P1 |
| PER-6 | **Formas de pago mixtas**: depósito CBU + saldo en efectivo | P1 |
| PER-7 | **Resumen por obra** (total y horas) → costo real de mano de obra por obra | P1 |

## Cómo funciona hoy

Los encargados llevan **planillas de papel** en obra. Administración las transcribe y arma la liquidación quincenal en Excel, tardando entre 3 y 5 días.

El objetivo del cliente no es que el encargado cargue desde el celular — eso quedó explícitamente **fuera de alcance por ahora**, con un horizonte declarado de un año. Lo que quiere es que administración cargue de a poco, media hora por día, en vez de acumular todo al cierre.

## La liquidación no es un recibo de sueldo

El propio cliente lo aclaró: la liquidación que hacen no es formal porque se paga mucho en efectivo.

Es un **cálculo interno de pago quincenal**, no un recibo con aportes. No hay que modelar cargas sociales, convenio ni AFIP. Sí hay que ser fiel a lo que hacen hoy: *"lo hacemos lo más fiel posible a lo que ya están haciendo"*.

## Doble uso del dato

El valor del jornal alimenta dos cosas a la vez:

1. La **liquidación** a pagar
2. El **costo de mano de obra** en el costeo de [[cotizaciones]] y el seguimiento de [[obras]]

Es el mismo número — el cliente lo confirmó explícitamente en la reunión.

## A definir

- **P4:** identificación por DNI, nombre o número de legajo. El padrón real usa **número de legajo**
- **P6:** las tarifas conviven por hora y por trabajo (ej. `POLIUREA 1 = 113.560`). Hay que entender la regla
- El padrón real está separado por empresa (`TRABAJOS VERTICALES PINO SAS`)
