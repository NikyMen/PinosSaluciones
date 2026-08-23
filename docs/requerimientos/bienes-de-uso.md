# Bienes de uso

**Módulo nuevo.** Prioridad 2–3. Convive con [[stock]] dentro de Compras y logística.

⏳ **Falta el archivo modelo** — el cliente lo está armando. Sin eso no se puede cerrar el diseño.

| ID | Requerimiento | Prio |
|---|---|---|
| BDU-1 | **Registro de vehículos y maquinaria**: patente, chasis, kilometraje, último service | P2 |
| BDU-2 | **Registro de equipamiento**: andamios, silletas, cuerdas, elementos de seguridad, con estado operativo | P2 |
| BDU-3 | **Mantenimiento preventivo**: tareas disparadas por kilometraje o fecha | P2 |

## El objetivo

Pasar de mantenimiento reactivo a preventivo. Hoy el criterio es esperar a que el vehículo se rompa. La empresa está trabajando con una consultora en este cambio.

La regla es simple y el cliente la explicó él mismo: la tarea se dispara contra los kilómetros recorridos, no contra la falla.

## Equipamiento

Andamios, silletas, cuerdas y EPP necesitan estado operativo y disparo de tarea cuando se rompen, para decidir entre comprar o alquilar para una obra puntual.

Esto conecta con el costeo: el alquiler de equipos es una línea de los gastos generales directos en el [[../modelo-datos/cotizador-cascada]].

## Fuera de alcance por ahora

**GPS en los vehículos.** Se mencionó con entusiasmo pero se cerró con un "lo vemos más adelante". No es un requerimiento.
