# Respuesta al Requerimiento Funcional Integral v4

- **Para:** PINO (Trabajos Verticales Pino S.A.S. y Constructora Pino S.R.L.)
- **De:** Consultoría Digital (Sistemas)
- **Fecha:** 8 de octubre de 2026
- **Responde a:** *Requerimiento Funcional Integral, versión 4.0* (7 de octubre de 2026) y a lo
  conversado en el grupo sobre el circuito de Compras.

> Borrador para revisar antes de enviar. Las fechas de cada etapa las completa Nicolás.

## Cómo lo vamos a entregar

El requerimiento se desarrolla en etapas. Cada una se prueba y se pone en producción por separado:

| Etapa | Qué incluye | Secciones del requerimiento |
|---|---|---|
| 0 | Correcciones de base: certificados sobre el neto, tope del 100 %, vínculo factura ↔ certificado | 4.3, 4.4 |
| 1 | Facturación parcial de cotizaciones y control de exceso; remitos facturados en parte | 4.2, 4.3 |
| 2 | Maestro de Cajas y Cuentas Bancarias | 4.1 |
| 3 | Circuito de Compras: solicitud, autorización, OP, OC, pagos parciales y recepción | 2, 2.1, 2.2 |
| 4 | Impresión, adjuntos y expediente en ZIP | 3, 5 |
| 5 | Bandeja de notificaciones y pendientes por rol | 6 |
| 6 | Certificados por ítem, anticipo, fondo de reparo y retenciones | 4.4 |
| 7 | Clasificación financiera por tipo de documento | 7 |

La etapa 0 ya está desarrollada:
- El certificado se calcula sobre el **neto** de la obra. Antes, el presupuesto venía con IVA y la
  factura le volvía a sumar el 21 %.
- El sistema no deja certificar más del 100 % de la obra.
- Si una factura de certificado se anula, el certificado vuelve a quedar pendiente de facturar.

## Respuestas a la sección 9

1. **Maestro de Cajas y Bancos con permisos de alta, modificación e inactivación.** Sí (etapa 2).
   - Lo administran Gerencia y Administración. El saldo inicial lo cambia sólo Gerencia.
   - Una cuenta usada no se borra: se inactiva. Cada cambio queda en la bitácora.
   - Los nombres que ya se usaron se migran al maestro, unificando los que estén escritos distinto. Antes les pasamos la lista para que la revisen.
2. **¿La agrupación de remitos controla mismo cliente y misma empresa?** Sí, ya lo controla el servidor,
   no sólo la pantalla.
   - Rechaza remitos de otro cliente, de otra empresa facturante, ya facturados o que sean devoluciones.
   - La factura no vuelve a descontar stock: lo descuenta el remito.
   - En la etapa 0 se agregó que dos facturas no puedan tomar el mismo remito al mismo tiempo.
3. **Saldo pendiente de facturación de cotizaciones.** Etapa 1 (la prioritaria). Se muestra en la
   cotización y en Seguimiento:
   - cotizado vigente (original + adicionales − reducciones);
   - facturado acumulado (− notas de crédito + notas de débito);
   - pendiente total y habilitado para facturar;
   - porcentaje y estado.

   El sistema bloquea la factura que supere lo disponible. Gerencia puede autorizar el exceso con motivo.
4. **Alcance del certificado por ítem.** Etapa 6.
   - Por cada ítem de la cotización: cantidad e importe de contrato, avance anterior, del período y acumulado, y saldo.
   - Recupero del anticipo y fondo de reparo con su plazo por obra (de 8 meses a 10 años).
   - Otras retenciones, por separado.
   - Aprobación del cliente, que habilita la facturación.
   - Rectificaciones y adicionales sin tocar la cotización original.
   - La certificación por porcentaje global se mantiene para las obras sin ítems.
5. **¿La OC se genera desde la Solicitud autorizada y antes de la OP?** Se implementa como lo pidieron
   en el grupo (ver abajo): **la OC se genera cuando Tesorería emite la OP** de una solicitud autorizada.
   La solicitud, la OC y la OP quedan vinculadas y la OC tiene numeración propia.
6. **Límite de $500.000.** Tomado así: hasta $499.999,99 no requiere autorización; desde $500.000
   inclusive la autoriza Gerencia o quien tenga el permiso "Autorizar compras" (Socio / Presidencia).
   Los dos tienen el mismo nivel.
7. **Bandeja de notificaciones y pendientes por rol.** Etapa 5.
   - Una bandeja con los estados Nueva, Leída, En gestión, Resuelta y Descartada (con motivo).
   - Asignación a una persona, fecha límite y escalamiento automático a Gerencia cuando se vence.
   - Cada aviso abre su documento.
   - Gerencia recibe las excepciones y lo escalado, no todos los avisos operativos.
8. **Imprimir OC/OP, descargar adjuntos y comprobantes.** Hoy ya se descargan en PDF las solicitudes y
   las órdenes de compra. En la etapa 4 se agrega:
   - el PDF de la OP, con constancia de entrega si el pago es en efectivo;
   - los adjuntos con historial de reemplazos;
   - "Descargar OC con adjuntos", en un solo PDF;
   - el expediente completo de la compra en ZIP.

## Circuito de Compras: lo que tomamos del grupo

Donde el PDF y lo conversado en el grupo no coinciden, seguimos lo del grupo:

1. **Compras** genera la solicitud según la necesidad, con su condición de compra (contado, cuenta
   corriente o plazo). Una vez generada queda en **sólo lectura**: no se modifica, sólo la anula Gerencia, con motivo.
2. Si el monto es **desde $500.000**, la autoriza Gerencia o Presidencia. Por debajo, pasa directo a Tesorería.
3. **Tesorería** emite la Orden de Pago, y con ella **se genera la Orden de Compra**.
   - De contado, el pago se registra enseguida con su comprobante.
   - En cuenta corriente o a plazo, la OP queda emitida con su vencimiento y se paga después.
   - Una OC puede tener varias OP parciales y muestra total, pagado y saldo.
4. **Compras** recibe el aviso con la OC, la OP y el comprobante de pago. Carga los remitos en una
   solapa propia: la recepción puede ser parcial, impacta en stock y el remito final cierra la compra.
5. Las **facturas de compra de menos de $500.000** las puede cargar Compras. Las de compras mayores
   las carga Tesorería. Las OP las emite sólo Tesorería.

**Les pedimos confirmar** que este circuito reemplaza al del PDF en dos puntos:
- la OC nace con la OP, no al autorizarse la solicitud;
- Compras carga facturas menores al límite.

## Preguntas que necesitamos que nos respondan

1. El límite de $500.000, ¿es **con IVA o sin IVA**? Por ahora lo tomamos con IVA (el total de la solicitud).
2. En la sección 7, la fila **"Orden de Compra"** tiene un texto que parece pegado de otra sección
   ("Se genera al autorizarse o habilitarse la compra…"). ¿Qué clasificación financiera corresponde a la OC?
3. La **redeterminación por índice CAC** del certificado, ¿entra en el alcance o se sigue calculando
   aparte? El certificado guarda el mes base para poder sumarla después.
4. En "habilitado para facturar", los **anticipos y cuotas** de venta, ¿son hitos que se cargan en la
   cotización (por ejemplo, "anticipo 30 % a la aprobación")? Hoy se habilita por certificados aprobados y remitos.
5. ¿Todas las obras se certifican **por ítem**, o sólo las de contrato grande? Las otras pueden seguir
   con el porcentaje global.
6. ¿Quién registra la **aprobación del cliente** del certificado: Producción o Administración? ¿Se adjunta el certificado firmado?

## Cómo leemos las áreas del documento

El sistema ya tiene roles. Para no duplicarlos, las áreas del documento se asignan así:

| Área del documento | Rol en el sistema |
|---|---|
| Tesorería / Administración y Finanzas | Administración |
| Producción | Arquitecto |
| Recursos Humanos | Administración |
| Gerencia / Socio / Presidencia | Gerencia, o cualquier usuario con el permiso "Autorizar compras" |
| Compras y Logística / Depósito | Compras |
| Ventas | Ventas |
