# Liquidación quincenal de jornales

**Fuente:** `_inbox/PLANILLA_SUELDO_QUINCENAL_2026.xlsm` — 27 hojas, 3,1 MB.

> El archivo tiene nombres, DNI, CUIL, domicilios y teléfonos reales. Está en `_inbox/`, fuera de git. Acá va sólo la estructura.

## Organización del libro

| Hoja | Contenido |
|---|---|
| `Enero1` … `Diciembre2` | Una hoja por quincena (`1` = del 1 al 15, `2` = del 16 a fin de mes) |
| `Nº Legajos` | Padrón de personal |
| `Registro Préstamos` | Préstamos con plan de cuotas |
| `Formulario` | Plantilla de impresión |

## Padrón de personal (`Nº Legajos`)

Encabezado: *"PERSONAL OPERATIVO TRABAJOS VERTICALES PINO SAS"* → **el padrón ya está separado por empresa.**

| Campo | Notas |
|---|---|
| N° | Número de legajo — es el identificador real |
| Apellido y Nombre | Un solo campo, en mayúsculas |
| Categoría | `BALANCINERO`, `ALBAÑIL AYUDANTE`, `SERENO`, `AYUDANTE`, `SILLETERO`, `MEDIO OFICIAL (SILLETERO)`… |
| Estado | `Vigente` / `Ex. Empleado` |
| Domicilio, Documento, CUIL, Fecha Nacimiento, Teléfono | |
| Fecha de Alta / Fecha de Baja | |
| Camisa, Pantalón, Botines, Desde | **Talles de indumentaria** — no estaba en ningún pedido, pero está en el modelo real |

## Parte diario de horas

Una fila **por persona, por día, por obra**:

| Campo | Ejemplo |
|---|---|
| Nº (legajo) | `172` |
| Apellido y Nombre | |
| Categoría | `MEDIO OFICIAL (SILLETERO)` |
| **Día** | `2026-08-03` |
| **T. Trabajo** | `Medio oficial` — determina la tarifa |
| **Horas** | `7` |
| **Obra** | `V1367` + nombre de la obra |
| Total 15na | horas × tarifa |

> **Ojo:** `Categoría` (del legajo) y `T. Trabajo` (del día) son campos distintos. Una persona categoría `SILLETERO` puede trabajar un día como `Limpieza`. La tarifa sale del **tipo de trabajo del día**, no de la categoría.

## Tabla de tarifas

Ordenada por tipo de trabajo. **No todas son por hora** — este es el punto que hay que aclarar con el cliente ([[../reuniones/2026-08-relevamiento-inicial]], P6):

| Tipo de trabajo | Tarifa | Parece ser |
|---|---|---|
| Ayudante / Medio Oficial / Oficial / Maquinista / Oficial Especializado | 4.000 – 7.420 | por hora |
| M.O Altura, Mt2 EXTERIOR / INTERIOR, MTS LINEAL REVOQUE | 4.000 – 6.650 | por hora o por m² |
| SILLETERO 1 / 2, Sereno | 3.000 – 9.300 | por hora |
| PLUS VIAJE AYUDANTE / OFICIAL 40 % | 15.900 / 26.700 | adicional por viaje |
| Limpieza, Seguridad, POLIUREA 1 / 2, POLIURETANO 1 / 2 | 43.650 – 113.560 | **por trabajo, no por hora** |

## Deducciones y ajustes por persona

- Uniforme (importe + descripción)
- Adelanto (importe + fecha)
- Préstamo (importe + fecha) — plan de cuotas en `Registro Préstamos`
- Descuento
- Embargo (importe + descripción)
- Saldo actual / Saldo anterior
- Ajuste de quincena anterior (importe + descripción)
- **Total deducción**

## Formas de pago

Conviven en la misma liquidación:
- **Depósito CBU** (bancos: Macro, Corrientes, Galicia)
- **Saldo a pagar en efectivo**
- **Total liquidación final**

## Préstamos (`Registro Préstamos`)

`Nº legajo` · `Apellido y Nombre` · `Fecha` · `Importe préstamo` · `Importe de cuota` · `Cantidad de cuotas` · `Importe devolución` · `Fecha finalización` · `Observaciones` (`DESCONTADO`) · `Detalle` (`Inicio 1ra 15na sep-25 / Fin 2da 15na jun-26`)

## Los dos resúmenes que produce la planilla

**Por persona** — es el recibo:
`Total Liq. Final` · `Depósito CBU` · `Adelantos` · `Cuotas Prest.` · `Uniformes` · `Embargos` · `T. Deducciones` · `Saldo Act.` · `Saldo Ant.` · `Saldo en Efectivo`

**Por obra** — `Obras` · `Total Quincena` · `Cantidad de Horas`

> Este segundo resumen es **el costo real de mano de obra por obra**. Es exactamente el número que el cliente quiere ver impactado en la obra y comparado contra lo presupuestado en el [[cotizador-cascada]].

## Códigos de obra

Formato `<letra><número> <NOMBRE DE OBRA>`, por ejemplo `V1367` o `C1477`.

**`V` = Trabajos Verticales · `C` = Constructora.** El prefijo de la empresa emisora ya está en uso hoy. Coincide con el certificado modelo (`COT-747` → obra `V747`).
