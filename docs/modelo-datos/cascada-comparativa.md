# Cascada — comparativa de las 7 planillas reales

Lectura celda por celda de los 7 libros que mandó el cliente. El objetivo es
separar **lo que es plantilla** (idéntico en los 7, se hardcodea) de **lo que es
dato de la cotización** (cambia siempre, va a la base) y de **lo que es error de
Excel** (no se replica). Complementa a [[cotizador-cascada]], que describe el
algoritmo; esto describe las *variantes*.

Fuente: `docs/*.xlsx` y `docs/_inbox/*.xlsx`.

---

## 1. Las 5 pestañas y cómo se encadenan

Los 7 libros tienen exactamente las mismas 5 pestañas y el mismo encabezado
(`CLIENTE`, `OBRA`, `FECHA`, `CONTACTO`). El flujo de datos es en una sola
dirección:

```
Análisis de precios ──SUMIF por RUBRO──▶ Cascada ──coeficiente k──▶ Precio ──▶ PDF al cliente
        │
        ├──SUMIF por DENOMINACIÓN──▶ Insumos   (lista de compras + dotación)
        └──columnas Q/R/S──────────▶ Programa de trabajo
```

### Análisis de precios — el único lugar donde se carga información

Una fila por ítem de obra (`1.1.`, `5.7.`…) y debajo sus insumos. Cada insumo:

| Col | Campo | Qué es |
|---|---|---|
| A | RUBRO | `MO` / `MAT` / `EQUIPOS` — **la clave que después suma la Cascada** |
| B | ÍTEM | código de artículo (`110041`, `101001`) — opcional, sólo materiales |
| C | DENOMINACIÓN | el nombre, que además es la clave de agrupación en Insumos |
| D | UNIDAD | `hs`, `lts`, `kg`, `U`, `bolsa`, `rollo`, `m2`, `M3` |
| E | CANTIDAD | **coeficiente de consumo por unidad de obra** (0,4 lts por m²) |
| F | precio unitario del insumo |
| G | `=E*F` → costo del insumo por unidad de obra |
| N | `=E*$E$item` → cantidad total absoluta |
| O | `=F` |
| P | `=N*O` → costo total del insumo |
| Q, R, S | PERSONAS · DÍAS TOT (`=N/8`) · DÍAS DE TRABAJO (`=R/Q`) |

Dos hechos que importan para el modelo:

- **El coeficiente casi nunca se escribe como coeficiente.** Se escribe como
  `=80/E11` (80 lijas en 5.250 m²) o `=8/15` (8 horas cada 15 m²). La gente
  piensa en total y divide. La UI tiene que aceptar las dos formas de carga.
- **La fila del ítem (`G11 = SUM(G12:G22)`) es el precio unitario a costo.**
  Ese número, multiplicado por el coeficiente de la Cascada, es lo que se
  cotiza. Todo lo demás cuelga de ahí.

### Precio — la oferta

`precio unitario del ítem = 'Análisis'!G_ítem × Cascada!k`, más el texto de
descripción técnica, plazo de ejecución y forma de pago. Es lo único que ve el
cliente.

### Insumos — la lista de compras

`SUMIF` por DENOMINACIÓN sobre la columna N. Da cantidad total y precio total
por insumo, más PERSONAS / DÍAS. Es el pedido a compras y la dotación de obra.

### Programa de trabajo — **existe pero no se usa**

En los 7 libros tiene sólo el encabezado, la fila del ítem y una celda
combinada que dice `26 DIAS` / `24 DIAS`. No hay cronograma real. No hay que
copiar esta pestaña: hay que reemplazarla por algo que sirva.

---

## 2. La cascada — los 9 escalones, idénticos en los 7

```
1  COSTO - COSTO
     MATERIALES   = SUMIF(RUBRO;"MAT";precio parcial)
     MANO DE OBRA = SUMIF(RUBRO;"MO";precio parcial)
     EQUIPOS      = SUMIF(RUBRO;"EQUIPOS";precio parcial)
2  GASTOS GENERALES DIRECTOS = suma de ~40 conceptos (cantidad × precio unitario)
3  COSTO       = 1 + 2
4  GGI         = 18 % de COSTO
5  SUB TOTAL 1 = 3 + 4
6  BENEFICIOS  = 30 % de SUB TOTAL 1
   COSTO FINANCIERO = % de SUB TOTAL 1   ← existe en los 7, vale 0 en los 7
7  SUB TOTAL 2 = 5 + 6
8  IIBB        = 2,5 % de SUB TOTAL 2
   SUB TOTAL 3 = 7 + IIBB
9  IVA         = 21 %
   PRECIO      = SUB TOTAL 3 + IVA
```

Los porcentajes se aplican **en cascada, no acumulados**: cada escalón toma el
subtotal del anterior. El resultado es un multiplicador único.

### El coeficiente `k` es la bisagra de todo el sistema

```
k = PRECIO / COSTO-COSTO
```

La pestaña Precio no vuelve a recorrer la cascada: multiplica el costo unitario
de cada ítem por ese único número. Es lo que permite cotizar 6 ítems distintos
con una sola cascada. **Si el sistema calcula bien `k`, todo lo demás sale.**

---

## 3. Los 7 libros, lado a lado

| Planilla | Ítems | Costo directo | MAT / MO / EQ | GGD s/costo | Benef. | `k` | Base IVA |
|---|---|---|---|---|---|---|---|
| PINTURA EN ALTURA | 1 | 36.749.313 | 47 / 53 / 0 % | 9,0 % | 30 % | 2,065 | ST2 |
| PINTURA INTERIOR | 1 | 54.149.125 | 62 / 38 / 0 % | 7,3 % | 30 % | 2,033 | ST2 |
| POLIUREA 9 de Julio | 2 (1 apagado) | 7.475.212 | 97 / 3 / 0 % | 5,9 % | **34,777 %** | 2,081 | ST2 |
| POLIURETANO | 1 | 10.425.956 | 92 / 8 / 0 % | 10,2 % | 30 % | 2,088 | ST2 |
| REVOQUE EXTERIOR | **6** | 8.575.147 | 38 / 62 / 0,00007 % | **30,4 %** | 30 % | **2,481** | **ST3** |
| BREAR REVOQUE INT. | varios | 9.635.963 | 63 / 36 / **1,1 %** | 3,8 % | **25 %** | **1,892** | ST2 |
| IMPERMEABILIZACIÓN | 1 | 11.984.955 | 78 / 22 / 0 % | 6,8 % | 30 % | 2,023 | ST2 |

Cinco de los siete caen en `k` = 2,02–2,09. Los dos que se salen se explican
solos: REVOQUE tiene 30 % de gastos generales directos (dirección de obra
propia, higiene y seguridad, balancín) y BREAR bajó el beneficio a 25 %.

---

## 4. Lo que es igual en los 7 — la plantilla

**Estructura.** Los 9 escalones, en ese orden, con esos nombres. Sin excepción.

**Porcentajes por defecto.** GGI **18 %**, beneficio **30 %**, costo financiero
**0 %**, IIBB **2,5 %**, IVA **21 %**.

> ⚠️ En la reunión el cliente dijo que los gastos generales indirectos son 20 %.
> Las 7 planillas usan 18 %. Hay que confirmarlo, pero el dato duro dice 18.

**El catálogo de gastos generales directos.** 31 conceptos aparecen en **7 de 7**
con el mismo texto exacto, agrupados en 6 bloques. Ése es el catálogo a
precargar:

1. **Dirección de obra** — sueldos/honorarios · viáticos (día) · alojamiento (día) ·
   combustible (km) · mantenimiento vehicular (km) · pasajes · gastos varios de
   movilidad · librería · seguros (mes) · indumentaria y EPP (juego)
2. **Personal operativo** — viáticos · alojamiento · combustible · mantenimiento
   vehicular · pasajes · gastos varios · seguros · indumentaria y EPP
3. **Higiene y seguridad** — programa de H&S · honorarios del responsable ·
   elementos de señalización · permiso de obra / uso de vereda
4. **Logística y compras** — fletes de materiales · viáticos y alojamiento de
   chóferes · combustible · mantenimiento vehicular · pasajes · gastos varios ·
   **impuesto al cheque** · gastos administrativos
5. **Pañolero** — sueldo/honorarios · viáticos · alojamiento · movilidad
6. **Institucionales** — sellados · garantía de oferta · garantía de ejecución ·
   fondo de reparo · impresiones y librería para ofertas · representación técnica

Casi todos van en cero en cualquier obra dada: la lista es un **checklist para
no olvidarse**, no una lista de costos reales. En POLIUREA sólo 8 de 39 tienen
valor. Eso es una decisión de UI: mostrar los cargados, plegar el resto.

**Tres conceptos calculados, no cargados a mano:**

| Concepto | Fórmula real en las planillas |
|---|---|
| Impuesto al cheque | % **sobre el total de materiales** (0,6 % · 1 % · 1,2 % según libro) |
| Representación técnica | 3 % del costo-costo (REVOQUE, apagado) |
| Seguros / EPP del personal | `personas × días / 25` → prorrateo mes-hombre |

Ese último es un patrón que se repite: `=7*78/25` (7 personas, 78 días, 25
días-mes), `=(7*78/25)/6`, `=3*5/25`, `=0,24/6`. La gente está prorrateando a
mano un costo mensual sobre la duración de la obra. **El sistema debería
calcularlo solo**, tomando personas y días del propio Análisis de precios
(columnas Q y R, que ya los tienen).

---

## 5. Lo que cambia — los parámetros de la cotización

### 5.1. El beneficio a veces se despeja al revés

POLIUREA tiene `BENEFICIOS = 34,777129088592147 %`. Ese número no lo eligió
nadie: es Goal Seek. Fijaron el precio de venta en **$91.500/m² con IVA**
(precio redondo, $15.555.000 total) y despejaron el beneficio hacia atrás.

Es un modo de uso real y frecuente. El cotizador necesita las **dos
direcciones**: cargar el margen y ver el precio, o fijar el precio y ver qué
margen queda. Sin eso, el usuario vuelve al Excel.

### 5.2. Precio con y sin factura — el coeficiente 1,105

PINTURA EN ALTURA, POLIURETANO e IMPERMEABILIZACIÓN calculan `PRECIO / 1,105` y
lo rotulan *"sin facturación"*. Es el 10,5 % de recargo por facturar. Está
fuera de la cascada, colgado al final.

En POLIURETANO son directamente dos renglones de salida:
`Mano de Obra y Materiales con facturación 19.859,91` y
`sin facturación 17.972,77`.

Decisión a tomar: si el sistema lo modela como un campo más, o si eso no debe
existir en un sistema con trazabilidad. **No es una decisión técnica.**

### 5.3. La base del IVA no es la misma en todos

Seis planillas calculan `IVA = 21 % de SUB TOTAL 2`, o sea **sin** los ingresos
brutos. REVOQUE EXTERIOR lo calcula sobre SUB TOTAL 3, **con** IIBB adentro.

No es un detalle: en PINTURA EN ALTURA la diferencia son **$322.672**. Hay que
elegir una y que sea siempre la misma. (Lo correcto es sobre ST3 — IIBB es
parte de la base imponible —, que es lo que hace REVOQUE; las otras seis
subfacturan el IVA.)

### 5.4. Presentación: un ítem o seis

- **Pinturas, poliurea, poliuretano, impermeabilización** → un solo ítem, un
  solo precio por m².
- **REVOQUE EXTERIOR** → 6 ítems reales (balancín, puente de adherencia,
  enchape, revoque proyectado, mochetas, bandejas de protección) y **además**
  una segunda tabla que colapsa los 6 en un único renglón de $43.962/m² sobre
  los 400 m² de revoque.

O sea: la misma cotización, dos presentaciones. Detallada para el que pide
detalle, unificada para el que quiere un número por m². **Las dos hay que
poder emitirlas.**

### 5.5. Materiales dolarizados

POLIUREA y POLIURETANO escriben el precio del material como `13*1520`,
`12,57*1520`, `5,1*1455`: cantidad en dólares × tipo de cambio, tipeado adentro
de la fórmula. Cuando cambia el dólar hay que reeditar celda por celda —
y por eso, en POLIUREA, la pestaña Análisis quedó a 1520 mientras Insumos
seguía a 1400.

El sistema necesita **precio en moneda origen + cotización del día**, no el
producto ya resuelto.

### 5.6. Actualización del precio

| Planilla | Cláusula |
|---|---|
| REVOQUE EXTERIOR | *"Actualización mediante índices CAC — mes base septiembre 2025"* |
| PINTURA EN ALTURA | *"Sin reajustes ni modificaciones al precio acordado"* |

Y las formas de pago van de *"40 % a la aprobación, saldo a 30/60/90"* a
*"30 % de anticipo, saldo por certificaciones mensuales"*. Conecta directo con
[[certificado-obra]].

### 5.7. Detalles menores que igual hay que decidir

- **`+ 0,01` al precio final** en 5 de 7 (`=+G79+G81+0.01`). Es un desempate de
  redondeo hecho a mano. En el sistema no debe existir.
- **Dónde se mide la incidencia %**: PINTURA EN ALTURA e IMPERMEABILIZACIÓN
  miden cada bloque contra el **precio final**; las otras cinco contra el
  **costo directo**. Da porcentajes muy distintos para lo mismo. Hay que fijar
  una base.
- **`EQUIPOS` casi nunca se usa**: sólo BREAR (1,1 %) y REVOQUE (0,00007 % —
  una máquina proyectadora a $190/hora, que es claramente un precio viejo).
  El rubro existe en los 7 pero está muerto. Conecta con
  [[../requerimientos/bienes-de-uso]].

---

## 6. Lo que está roto en las planillas — el argumento para el sistema

Esto no es anecdótico: es la lista de cosas que el sistema arregla solo, y
sirve para justificar el módulo.

| Problema | Dónde | Consecuencia |
|---|---|---|
| `#REF!` en el precio por m² | PINTURA ALTURA `K75`, IMPERMEAB. `K75`, REVOQUE `K81` | la celda del precio unitario no calcula |
| `#REF!` en el coeficiente | POLIURETANO `Precio!F11` | **la pestaña Precio entera está rota** |
| Vínculo a otro libro | REVOQUE `[1]Cascada!$H$89` | depende de un archivo que no está |
| `SUMIF` con el rango corrido | Insumos de los 7 (`C10:P21`, `C11:P23`, `C12:P25`…) | al arrastrar se desplazó el rango; funciona por casualidad |
| Cantidad distinta entre pestañas | PINTURA ALTURA: 5.250 m² en Análisis, **4.860 m²** en Precio | se cotizó sobre una superficie y se ofertó otra |
| Precio unitario distinto entre pestañas | PINTURA ALTURA: oficial a 8.780 en Análisis, **6.601,61** en Insumos | la lista de compras no cierra con el costo |
| Encabezado pisado | PINTURA ALTURA: Cascada dice *San Martín 353*, Programa dice *San Luis 699 – Antares III* | se copió el libro de otra obra y quedó a medio actualizar |
| Filas con fórmula y sin concepto | `G27`, `G55`, `G36`… en varios | suman cero, pero nadie sabe qué eran |
| Números sueltos sin rótulo | POLIUREA `G85=13.640.520`, POLIURETANO `I12=1.113.000`, INTERIOR `H87="precio antiguo 45811"` | historial de precios en celdas al voleo |

---

## 7. Qué implica para el modelo de datos

Hoy `quotes` tiene un único `amountCents`. Para soportar esto hacen falta
cuatro piezas:

**1. Ítems con composición.** `quote.items[]`, cada uno con `code` (`5.7.`),
`name`, `unit`, `qty`, y `composition[]` de `{ kind: MAT|MO|EQUIPOS, itemCode,
name, unit, coefPerUnit, unitPriceCents, currency, fxRate }`. Los precios
unitarios salen del catálogo ([[../requerimientos/stock]]) y los jornales de
personal ([[../requerimientos/personal]]), pero **congelados en la cotización**:
el precio del día que se cotizó no puede moverse después.

**2. Los gastos generales directos como líneas.** `quote.overheads[]` de
`{ conceptKey, group, unit, qty, unitPriceCents, formula? }` sobre el catálogo
precargado de 31 conceptos. `formula` para los tres que son calculados
(impuesto al cheque sobre materiales, representación técnica sobre costo,
prorrateos de mes-hombre).

**3. Los parámetros de la cascada.** `quote.cascade` de
`{ ggiPct, benefitPct, financialPct, iibbPct, ivaPct, ivaBase, chequePct }`,
con default de configuración global y override por cotización. Más el modo
inverso: fijar `targetPricePerUnit` y despejar `benefitPct`.

**4. Una función pura de cálculo.** Entra costo directo + overheads +
parámetros, sale la cascada completa con los 9 escalones, el coeficiente `k`,
el precio por unidad y las incidencias. Sin efectos, testeable contra estos 7
libros como casos de prueba — los números están todos en este documento.

Y dos salidas que ya existen en el Excel y no hay que inventar:

- **Insumos** = agrupar la composición de todos los ítems por insumo. Es el
  pedido a compras.
- **Dotación** = `Σ horas / 8` y `/ personas`. Es lo que alimenta la
  planificación de obra.

> El PDF al cliente muestra **sólo la pestaña Precio**. La cascada es interna.
> Es un requisito explícito y repetido en la reunión.
