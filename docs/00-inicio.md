# Pino Soluciones Técnicas — sistema de gestión

Punto de entrada de la vault. Todo lo demás cuelga de acá.

**Empresa:** constructora y trabajos verticales en Corrientes, Argentina.
Revoque, pintura en altura, impermeabilización, poliurea. Dos razones sociales.

**Qué se está construyendo:** un sistema que unifique cotización, obra, stock,
personal y administración, para poder responder una pregunta que hoy no tiene
respuesta exacta: *cuánto costó realmente cada obra*.

---

## Por dónde empezar

| Si querés… | Andá a |
|---|---|
| Entender qué pidió el cliente | [[reuniones/2026-08-relevamiento-inicial]] |
| Ver el estado del proyecto | [[PLAN]] |
| Saber qué falta construir | [[gap-analysis]] |
| Buscar un requerimiento puntual | [[requerimientos/00-backlog]] |
| Entender un término del rubro | [[glosario]] |

---

## Los cuatro modelos que hay que respetar

Estos salieron de los archivos reales de la empresa, no de la charla.
Son la referencia contra la que se valida cualquier diseño.

- [[modelo-datos/cotizador-cascada]] — los 9 pasos que van del costo al precio
- [[modelo-datos/liquidacion-quincenal]] — el parte diario y la liquidación
- [[modelo-datos/certificado-obra]] — el avance por ítem y el anticipo
- [[modelo-datos/cotizacion-pdf]] — lo que efectivamente ve el cliente

Y el estado actual del código: [[modelo-datos/esquema-actual]] *(generado)*.

---

## Los módulos

Ordenados por la prioridad que definió el cliente.

1. [[requerimientos/cotizaciones]] · [[requerimientos/obras]]
2. [[requerimientos/stock]]
3. [[requerimientos/administracion]] · [[requerimientos/personal]]
4. [[requerimientos/logistica]] · [[requerimientos/bienes-de-uso]]

El tablero gerencial queda deliberadamente para el final.

---

## Decisiones tomadas

- [[decisiones/2026-08-certificado-por-item]]

---

## Las tres cosas que conviene tener presentes

**El certificado no es un botón.** El modelo real certifica ítem por ítem, con
arrastre del acumulado anterior. Ver [[modelo-datos/certificado-obra]].

**La cotización es la pieza estructural.** Sin ítems jerárquicos no hay costeo
ni certificados. Eso fija el orden de trabajo.

**Simplicidad por sobre funcionalidad.** Buena parte de los usuarios finales no
maneja tecnología. Fue un pedido explícito y repetido.

---

## Qué falta que mande el cliente

- Registro de bienes de uso *(lo está armando)*
- Planilla de tareas de mantenimiento de seguridad e higiene
- Un modelo de factura
