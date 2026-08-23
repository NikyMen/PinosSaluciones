# Glosario del rubro

Términos que aparecen en las planillas, los comprobantes y la reunión. Si venís
del lado del software y no de la construcción, esta es la traducción.

Volver a [[00-inicio]].

---

## Cotización y costeo

**Rubro** — La categoría de un insumo dentro del análisis de precios. Tres valores
en las planillas: `MO` (mano de obra), `MAT` (materiales) y `EQUIPOS`.

**Ítem** — Una unidad de trabajo cotizable, numerada jerárquicamente (`1`, `1.1`,
`1.2`, `2`, `2.1`…). Por ejemplo, *"1.3 Revoque proyectado interior - 2 en 1"*.
El certificado después mide el avance de cada uno por separado.

**Análisis de precios** — El desglose de cuánto insumo hace falta por unidad de
obra. La cantidad es un **coeficiente**: 1,25 kg de espuma por m², 0,04 horas de
oficial por m². Multiplicado por la superficie total da la necesidad real.

**Cascada** — Como llaman internamente al cálculo que va del costo directo al
precio final en 9 pasos. Ver [[modelo-datos/cotizador-cascada]].

**Gastos generales directos** — Costos atribuibles a *esta* obra pero que no son
material ni mano de obra: dirección de obra, viáticos, fletes, seguros, el
programa de higiene y seguridad, el impuesto al cheque.

**Gastos generales indirectos** — La parte de la estructura fija de la empresa que
se le carga a la obra, como porcentaje. En la planilla real, 18 %.

**Beneficio** — El margen. Se calcula sobre el subtotal, no sobre el costo. Nunca
aparece en el PDF que ve el cliente.

**Fondo de reparo** — Porcentaje que el comitente retiene de cada certificado como
garantía, y devuelve al terminar la obra sin observaciones.

**Representación técnica** — Honorarios del profesional matriculado que firma la
obra. En obras que lo exigen, es un costo obligatorio.

**IIBB** — Ingresos Brutos, impuesto provincial. En la planilla, 2,5 %.

---

## Obra y certificación

**Certificado de obra** — El comprobante que dice cuánto se avanzó en un período y
por lo tanto cuánto se puede facturar. Se numeran correlativamente por obra: el
modelo que mandaron es el **número 20** de un solo contrato.

**Avance anterior / del período / acumulado** — Las tres columnas de todo
certificado. *Anterior* es lo que ya se había certificado, *del período* lo nuevo,
*acumulado* la suma. Sin el anterior no se puede emitir el siguiente.

**Anticipo financiero** — La seña que se cobra al aprobar el presupuesto (30 a 50 %).
Como ya se cobró, cada certificado descuenta la parte proporcional para no cobrarla
dos veces.

**Redeterminación** — Ajuste del precio por inflación entre la fecha de cotización
y la de ejecución. Se calcula contra un índice publicado y un mes base.

**Índice CAC** — El índice de la Cámara Argentina de la Construcción, que es el que
usa el certificado modelo para redeterminar.

**Comitente** — Quien encarga la obra. En el sistema es el cliente.

---

## Personal

**Legajo** — El número que identifica a cada persona. Es la clave real del padrón,
no el DNI.

**Categoría** — El puesto según convenio: `OFICIAL`, `MEDIO OFICIAL`, `AYUDANTE`,
`BALANCINERO`, `SILLETERO`, `SERENO`, `ALBAÑIL AYUDANTE`.

**Tipo de trabajo** — Qué hizo esa persona *ese día*, que puede no coincidir con su
categoría. Determina la tarifa. Alguien categoría `SILLETERO` puede trabajar un día
de `Limpieza` y cobrar la tarifa de limpieza.

**Quincena** — El período de liquidación. Del 1 al 15 y del 16 a fin de mes. En la
planilla, una hoja por quincena.

**Jornal** — El valor de la hora o del trabajo. Alimenta dos cosas a la vez: lo que
se le paga a la persona y el costo de mano de obra de la obra.

**Embargo** — Retención judicial sobre el pago. Es una de las deducciones de la
liquidación.

**Pañolero** — Quien administra el pañol: el depósito de herramientas y equipos.

---

## Oficios y equipos

**Silletero** — Quien trabaja colgado en una **silleta**, una tabla suspendida por
cuerdas. Es el oficio central de "trabajos verticales".

**Balancín** — Plataforma suspendida que sube y baja por la fachada, para trabajos
en altura. Se arma y desarma, y eso se cotiza como ítem propio: en el certificado
modelo, 23 unidades.

**Andamio** — Estructura apoyada desde el piso. A diferencia del balancín, no
cuelga.

**EPP** — Elementos de protección personal: casco, arnés, guantes, botines.

**Bienes de uso** — Lo que la empresa posee y usa sin consumir: vehículos,
maquinaria, andamios, silletas, cuerdas. Se distinguen de los materiales, que sí se
consumen.

---

## Materiales y trabajos

**Revoque proyectado** — Revoque aplicado a máquina en vez de a mano. Se mide en m²
y se cotiza como "2 en 1" o "3 en 1" según las capas que reemplaza.

**Puente de adherencia** — Producto que se aplica antes del revoque para que agarre
sobre superficies lisas como el hormigón.

**Enchape** — Recubrimiento sobre estructura de hormigón.

**Cantonera** — Perfil metálico o plástico que protege las aristas.

**Mocheta** — El lateral del hueco de una ventana o puerta. Se cotiza aparte porque
es trabajo fino.

**Poliuretano** — Espuma proyectada, se usa como aislante térmico.

**Poliurea** — Recubrimiento impermeabilizante que se proyecta en caliente y forma
una membrana continua sin juntas.

**Entonador** — Pigmento concentrado que se mezcla con pintura blanca para darle
color. Por eso el stock necesita manejar pintura base y entonadores por separado.

**Membrana** — Material impermeabilizante en rollo.

---

## Circulación de materiales

**Remito** — El papel que acompaña la entrega. El encargado en obra lo firma al
recibir. Es el punto donde el stock se descuenta. Ver [[requerimientos/logistica]].

**Pañol** — El depósito de herramientas y equipos.

**Flete** — Transporte de materiales. Se cotiza por kilómetro y por tipo de
material.

---

## Administrativo

**ARCA** — El organismo fiscal argentino, antes AFIP. El sistema **no** se integra
con él: las facturas se emiten por afuera y se registran a mano.

**Factura A / B / C** — Tipo de comprobante según la condición fiscal de quien
compra. Determina si el IVA se discrimina o va incluido.

**CUIT / CUIL** — Identificación fiscal. CUIT para empresas, CUIL para personas en
relación de dependencia.

**Certificado / Factura** — No son lo mismo y conviene no mezclarlos. El certificado
dice cuánto se avanzó; la factura es el comprobante fiscal que se emite en
consecuencia.
