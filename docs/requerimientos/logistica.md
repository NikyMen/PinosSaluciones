# Logística

**Módulo nuevo.** Vive dentro de Compras. Prioridad 2–3.

| ID | Requerimiento | Prio |
|---|---|---|
| LOG-1 | **Tareas del día** asignadas a la persona de logística | P2 |
| LOG-2 | **Ruta de entrega** ordenada por obra — requiere ubicación en [[obras]] | P2 |
| LOG-3 | **Remito** en PDF al salir material a obra, con firma del encargado que recibe | P2 |
| LOG-4 | **Foto** del material entregado, además de la firma | P2 |

## El problema a resolver

Hoy la asignación va por WhatsApp o de palabra. El cliente lo resumió como dejar de manejarse con el "te dije / no te dije / me olvidé".

El remito ya existe en papel: se imprime, el repartidor lo lleva, el encargado en obra lo firma. Lo que falta es que salga del sistema y descuente [[stock]].

## Restricción real

La persona a cargo de logística no usa computadora. El horizonte que puso el cliente es de un año para que entre al sistema. La interfaz tiene que ser mínima: entrar, ver qué hay que llevar hoy y a dónde, imprimir el remito.

## Sobre LOG-4

La foto surgió de una anécdota sobre remitos firmados sin entrega real. Se aceptó de palabra pero no se definió. Tratarlo como acordado en principio, no como especificado.
