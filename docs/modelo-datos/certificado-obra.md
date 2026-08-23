# Certificado de avance de obra

**Fuente:** `_inbox/(certificadoDeObra)747 - RS - BELGRANO 450 - Certificado 20.pdf`

> ⚠️ **Este es el hallazgo más importante del material.** En la reunión el certificado se describió como *"un botón que genera el certificado por el 50 % de la obra"*. El modelo real es bastante más que eso.

## Encabezado

| Campo | Valor del modelo |
|---|---|
| CLIENTE | `RS ARGENTINA S.A.` |
| OBRA | `PROVISION DE MATERIALES, EQUIPOS Y MANO DE OBRA - REVOQUE Y PINTURA INTERIOR Y EXTERIOR - BELGRANO 450 - CORRIENTES` |
| FECHA COT | `15/08/2025` |
| Nº cotización | `COT-747` |
| Monto de contrato | `$ 370.000.078,82` |
| ANTICIPO | `$ 68.000.000,00` |
| **CERTIFICADO NRO** | `20` ← numeración correlativa por obra |
| Fecha del certificado | `31/07/2026` |

Un solo contrato lleva **20 certificados** y sigue abierto: casi un año de obra.

## Cuerpo — avance por ítem

Los ítems son **los mismos de la cotización**, jerárquicos:

```
1    EJECUCION DE REVOQUE INTERIOR
1.1  COLOCACION DE PUENTE DE ADHERENCIA INTERIOR
1.2  ENCHAPE SOBRE ESTRUCTURA DE HORMIGON INTERIOR
2    EJECUCION DE REVOQUE EXTERIOR
2.1  ARMADO Y DESARMADO DE BALANCIN EXTERIOR
...
```

Cada ítem lleva:

| Columna | Ejemplo |
|---|---|
| Unidad | `M2` / `UNIDAD` |
| Cantidad de contrato | `6939,00` |
| Precio unitario | `$ 20.349,30` |
| Importe de contrato | `$ 141.203.815,41` |
| **Avance anterior** | `97,00 %` → `$ 136.967.700,95` |
| **Avance del período** | `0,00 %` → `$ 0,00` |
| **Avance acumulado** | `97,00 %` → `$ 136.967.700,95` |
| **Saldo** | `$ 4.236.114,46` |

Cada ítem avanza a su propio ritmo: en este certificado hay ítems al 97 %, otros al 72 %, otros al 0 %. **No existe un "porcentaje de la obra" único** que dispare el certificado.

Totales de la obra: `61,70 %` anterior · `2,65 %` del período · `64,35 %` acumulado.

## Pie — el cálculo a cobrar

```
CERTIFICADO A MES BÁSICO (A)                    $ 9.808.438,28
DESCUENTO POR ANTICIPO FINANCIERO (B)  18,38 %  $ 1.802.631,52
SUB TOTAL (C = A - B)                           $ 8.005.806,76
ÍNDICE CAC NIVEL GENERAL MES BASE 06.2025 (D)   $     16.643,40
ÍNDICE ...                                      (redeterminación)
```

Dos mecanismos que **no existen en la app**:

1. **Descuento por anticipo financiero** — el anticipo cobrado al inicio se va amortizando proporcionalmente en cada certificado. El 18,38 % es la proporción que representa el anticipo sobre el contrato.
2. **Redeterminación por índice CAC** — el certificado se ajusta por el índice de la Cámara Argentina de la Construcción contra un mes base. Es estándar en obra pública y privada grande en Argentina.

## Consecuencias de diseño

| Lo que se habló | Lo que muestra el modelo |
|---|---|
| Un `progress` global en la obra | Avance **por ítem**, con anterior / período / acumulado |
| Botón "generar certificado por el 50 %" | Carga del avance de cada ítem y cálculo del período |
| Importe = % × presupuesto | Importe = Σ(avance período × precio unitario) − anticipo + redeterminación |

Esto convierte el certificado de "un PDF" en **un módulo con estado propio**: numeración por obra, arrastre del acumulado anterior y cierre de período.

**Pendiente de confirmar con Fede** ([[../reuniones/2026-08-relevamiento-inicial]], P2 y P3):
- ¿Todas las obras se certifican así, o sólo las grandes con contrato?
- ¿La redeterminación por CAC entra en el alcance o se sigue calculando aparte?
