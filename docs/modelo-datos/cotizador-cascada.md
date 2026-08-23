# Cotizador "Cascada" — análisis de precios

**Fuente:** 7 planillas en `_inbox/*.xlsx` (revoque interior/exterior, impermeabilización, pintura interior/altura, poliurea, poliuretano).
Todas comparten la misma plantilla. Es el corazón de lo que el cliente pidió meter en el sistema.

> *"A mí me interesa poder ponerle valor a todo ese Excel de mierda que tienen en otro lugar."*

## Pestañas de la plantilla

| Pestaña | Contenido |
|---|---|
| **Análisis de precios** | Desglose por ítem: coeficiente de consumo por unidad |
| **Cascada** | La suma en cascada desde costo directo hasta precio final |
| **Precio / PRECIO 2** | Lo que ve el cliente: ítem, unidad, cantidad, precio unitario, total + condiciones |
| **Programa de trabajo** | Cronograma por semanas |
| **Insumos** | Resumen agregado por rubro, con personas y días |

Encabezado común: `CLIENTE`, `OBRA`, `FECHA`, `CONTACTO`.

## La cascada — algoritmo exacto

Esta es la fórmula a implementar. Los porcentajes son **configurables**, los valores son de una obra real:

```
1  COSTO DIRECTO
   1.1  MATERIALES                          3.262.468,80
   1.2  MANO DE OBRA                        5.312.671,96
   1.3  EQUIPOS                                     6,25
   ────────────────────────────────────────────────────
        subtotal costo directo              8.575.147,01

2  GASTOS GENERALES DIRECTOS                2.608.649,63
   (lista de ~40 conceptos — ver abajo)

3  COSTO = 1 + 2                           11.183.796,63

4  GASTOS GENERALES INDIRECTOS  18 %        2.013.083,39   ← % sobre COSTO
5  SUB TOTAL 1 = 3 + 4                     13.196.880,02

6  BENEFICIOS                   30 %        3.959.064,01   ← % sobre SUB TOTAL 1
   COSTO FINANCIERO              % (0 en este caso)
7  SUB TOTAL 2 = 5 + 6                     17.155.944,03

8  INGRESOS BRUTOS             2,5 %          428.898,60
   SUB TOTAL 3 = 7 + IIBB                  17.584.842,63

9  IVA                          21 %        3.692.816,95
   PRECIO FINAL                            21.277.659,59

   + precio por m² sin IVA  y  precio por m² con IVA
```

> ⚠️ En la reunión el cliente dijo *"los gastos generales indirectos son el 20%"*, pero la planilla real usa **18%**. Confirmar con el equipo de cotizaciones.

## Gastos generales directos — conceptos

Todos con `unidad`, `cantidad`, `precio unitario`. Los que no aplican van en cero.

**Dirección de obra** (una línea por especialidad: albañilería, cielorrasos, pintura, pintura en altura)
- Sueldos / honorarios · Viáticos (día) · Alojamiento (día) · Combustible (km) · Mantenimiento vehicular (km) · Pasajes · Estacionamiento y peajes · Librería · Seguros · Indumentaria y EPP

**Personal operativo** — mismo set de conceptos

**Higiene y seguridad**
- Programa de higiene y seguridad · Honorarios del responsable · Elementos de señalización

**Fletes y logística**
- Fletes por tipo de material (ladrillos, áridos, etc.) · Alquiler de montacargas · Viáticos, alojamiento y movilidad de chóferes

**Financieros e institucionales**
- Impuesto al cheque (**% sobre materiales**) · Pañolero (sueldo, viáticos, alojamiento, movilidad) · Permisos de uso de calle y vereda · Garantías de oferta y de ejecución · Fondo de reparo · Impresiones para presentación de ofertas · Representación técnica

## Análisis de precios — desglose por ítem

Una fila por insumo dentro de cada ítem de obra:

| Campo | Ejemplo |
|---|---|
| RUBRO | `MO` / `MAT` / `EQUIPOS` |
| ÍTEM | `101001` (código de artículo, opcional) |
| DENOMINACIÓN | `Espuma Poliuretano POLIRESINAS x kg` |
| UNIDAD | `hs`, `Kg`, `m2`, `rollo`, `KG` |
| CANTIDAD | **coeficiente de consumo por unidad de obra** (ej. 1,25 kg de espuma por m²) |
| PRECIO UNITARIO | costo del insumo |
| PRECIO PARCIAL | cantidad × precio unitario |
| % ITEM / % RUBRO | incidencia porcentual |

Al costado, el cálculo absoluto: `Cantidad parcial`, `Precio parcial`, y **`PERSONAS` / `DÍAS` / `DÍAS DE TRABAJO`** — de ahí sale la dotación que la obra va a necesitar.

## Implicancias para el sistema

1. La cotización necesita **ítems jerárquicos** (1, 1.1, 1.2, 2, 2.1…), no un solo importe. Hoy `quotes` tiene un único `amountCents`.
2. Cada ítem necesita su **composición** (materiales + mano de obra + equipos con coeficientes).
3. Los **precios unitarios de insumos** salen del catálogo de productos → conecta con [[../requerimientos/stock]].
4. Los **valores de jornal por categoría** salen de personal → conecta con [[../requerimientos/personal]].
5. `PERSONAS` y `DÍAS` alimentan la dotación de la obra y el aviso a compras.
6. El PDF al cliente muestra **sólo la pestaña Precio**. La cascada es interna. Es un requisito explícito y repetido.
