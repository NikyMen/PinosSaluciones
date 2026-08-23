# El certificado de obra se modela completo, por ítem

- **Fecha:** 2026-08-22
- **Estado:** aceptada
- **Afecta a:** [[../requerimientos/obras]] (OBR-3), [[../modelo-datos/certificado-obra]]

## Decisión

El módulo de certificados se modela **fiel al PDF real**: avance por ítem con anterior / período /
acumulado, numeración correlativa por obra y descuento proporcional del anticipo financiero.

Se descarta la versión simplificada por porcentaje global que se había hablado en la reunión.

## Por qué

El certificado modelo es el **número 20** de una obra de $370.000.078 que lleva casi un año abierta.
Con ítems al 97 %, al 72 % y al 0 % simultáneamente, un porcentaje único de obra no puede representarlo.

Hacer la versión simplificada significaría rehacer el módulo entero apenas aparezca la primera obra
grande — que es justamente el tipo de obra donde el certificado importa.

## Consecuencias

- El certificado deja de ser "un PDF" y pasa a ser **un módulo con estado propio**: arrastra el
  acumulado del certificado anterior y cierra período.
- **Depende de que las cotizaciones tengan ítems jerárquicos** (COT-11). No se puede certificar por
  ítem si la cotización no tiene ítems. Esto ordena la secuencia: primero el cotizador, después los
  certificados.
- `WorkSchema.progress` (número global) queda como dato de resumen, no como fuente del certificado.

## Queda abierto

La **redeterminación por índice CAC** aparece en el modelo pero no se decidió si entra en alcance.
Es la pregunta P3 del [[../reuniones/2026-08-relevamiento-inicial]] y hay que llevarla a Fede.

Modelar los certificados sin redeterminación no bloquea: se puede agregar después como un ajuste
sobre el subtotal, siempre que el certificado guarde el mes base.
