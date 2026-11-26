# Plan: envíos por transporte y salidas a utilitarios

- Fecha: 2026-11-16. Estado: **punto 1 hecho el 16/11** (envío por transporte, ver README › Envíos por transporte) y **puntos 2 y 3 hechos el 26/11** (envío de una venta y salida a un bien de uso, ver `docs/decisiones/2026-11-pendientes-ronda-10-11.md`). Siguen abiertas las preguntas para Jorge del final.
- Pedido de Jorge (Compras), por WhatsApp:
  - 13/11: una encomienda a Rosario, de 97 tachos de 20 l en 2 pallets, por Expreso Demonte, que pide remito con valor declarado.
  - 14/11: el remito de venta no sirve, porque pide cliente y factura.
  - 16/11: audio con las respuestas a la propuesta.
- Antecedentes: entrevista con Jorge del 10/11 (pedido J2 en `docs/reuniones/2026-11-10-ronda-cristian-jorge-fede-fer.md`).

## Qué pidió Jorge

1. **Sale con valor declarado.** Al despachar carga el precio unitario de cada material y el sistema saca el valor declarado total según las cantidades que manda.
2. **Nadie confirma en destino.** El envío va al depósito de Demonte en Rosario y de ahí lo retira un transporte local. No es una transferencia entre depósitos nuestros: no queda "en tránsito" esperando recepción.
3. **Comprobante del transporte después.** Una vez despachado, carga el remito de salida o el número de guía que le da el transporte (Demonte) para dejar constancia de que salió.
4. **No es frecuente.** Las encomiendas son cada tanto: tiene que ser simple, sin pasos de aprobación.
5. **Ventas pide lo mismo.** Las ventas por internet salen por Correo Argentino o Mercado Libre y necesitan el mismo registro.
6. **Utilitarios** (J2, 10/11). Lo comprado entra al depósito y de ahí sale a una obra **o a un utilitario**. Por ejemplo, el crique de la camioneta: son cuatro productos para cuatro destinos. La salida a obra ya existe (carrito y Caja). La salida a un vehículo o bien de uso no existe.

## Qué hay hoy y por qué no alcanza

| Pantalla | Qué hace | Por qué no sirve para esto |
|---|---|---|
| Ventas › Remitos de venta | Salida al cliente desde el Salón | Pide cliente y empresa que factura; es una venta |
| Stock y logística › Transferencias | Galpón ↔ Salón, con recepción | Sólo entre depósitos propios; queda en tránsito hasta que el otro confirma |
| Stock y logística › Caja (salida) | Salida a obra con el carrito | El destino es una obra; no lleva transporte, valor declarado ni guía |

## Propuesta

### 1. Envío por transporte (nuevo)

En **Stock y logística › Envíos** (al lado de Transferencias), con el botón **Nuevo envío**:

- **Empresa** que despacha (TV Pino o Constructora: encabezado del remito) y **depósito de origen** (Galpón o Salón).
- **Destino**, en texto libre con historial ("Depósito Demonte – Rosario"), y **quién retira o recibe**, opcional.
- **Transporte**: la empresa (Expreso Demonte, Correo Argentino, Mercado Libre… elegida de una lista que se va armando), la cantidad de **bultos** y de **pallets**.
- **Para qué es**, opcional: una **obra** (el costo se carga a la obra, como la salida a obra) o un **cliente**. Sin nada, es un traslado.
- **Materiales** del stock con cantidad y **precio unitario para el valor declarado**. Arranca con el último costo y se puede editar. El **valor declarado** es la suma.
- **Al emitir**:
  - Baja el stock del depósito de origen y registra el movimiento.
  - Queda en estado **Despachado** y genera el **remito de envío** en PDF.
  - Numeración propia: `ENV-n`.
  - El PDF lleva origen, destino, transporte, bultos y pallets, los materiales con cantidad, el valor declarado y la firma de quien entrega.
- **Después**: el botón **Cargar guía** pide el N° de guía o el remito del transporte, con su adjunto (foto o PDF), y el envío pasa a **Con guía**. Sin recepción ni confirmación en destino.
- **Anular**: con motivo, devuelve el stock. Sólo mientras no tenga guía.

### 2. Envío de una venta

Desde **Ventas › Remitos de venta**, el botón **Enviar por transporte** en el remito:

- Abre el mismo formulario con el cliente y los materiales del remito.
- **No mueve stock**, porque el remito de venta ya lo bajó.
- El valor declarado sale del total del remito y se puede editar.
- Sirve para Correo Argentino y Mercado Libre: después se carga la guía igual que en el punto 1.

### 3. Salida a un utilitario (J2)

- En la Caja, la salida puede tener como destino una **obra** (como hoy) o un **bien de uso** (vehículo o equipo del maestro de Bienes de uso).
- El costo queda imputado al bien de uso.
- La salida aparece en la ficha del bien y en el registro de salidas.
- El carrito sirve igual: cuatro productos con cuatro destinos son cuatro salidas.

## Datos

- Colección nueva `shipments`, con estos campos:
  - Número, empresa, origen y destino.
  - Quién recibe, transporte, bultos y pallets.
  - Obra y cliente (opcionales), y `salesRemitoId` (opcional, en el envío de una venta).
  - Renglones (material, cantidad, unidad, precio declarado) y valor declarado.
  - Estado: `despachado`, `con_guia` o `anulado`.
  - Guía, adjuntos e historial.
- El movimiento de stock usa lo mismo que la salida de la Caja, para que el costo y el registro de salidas queden iguales.
- Permisos: **Stock** para crear y cargar la guía; **Ventas** para el envío de un remito de venta.

## Preguntas para Jorge

El punto 1 se programó con estos supuestos: sale del stock, con obra opcional para cargarle el costo; el valor declarado arranca con el último costo y se puede cambiar; el remito muestra el precio de cada renglón y el total; los transportes sugeridos son Demonte, Correo Argentino y Mercado Libre, y se puede escribir otro.

1. ¿El envío a Rosario es para una **obra** o un **cliente** de allá, o es mercadería que queda en un depósito nuestro? Define si el costo va a una obra o si queda como stock "en Rosario". Si queda como stock, hace falta un tercer depósito y no una salida.
2. ¿El valor declarado va con el **costo** o con el **precio de venta**?
3. ¿El remito tiene que mostrar el **precio unitario** de cada renglón o sólo el valor declarado total?
4. ¿Qué transportes usan además de Demonte, Correo Argentino y Mercado Libre?

## Orden de trabajo

1. Envío por transporte (punto 1): modelo, API, pantalla, PDF y guía.
2. Envío desde el remito de venta (punto 2).
3. Salida a un bien de uso (punto 3).
4. Documentación: `README.md` (Stock), `AGENTS.md`, el acta del 10/11 (J2 y J6) y la decisión en `docs/decisiones/`.
