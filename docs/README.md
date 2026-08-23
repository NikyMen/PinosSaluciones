# Documentación de Pinos Soluciones

Esta carpeta es la **fuente de verdad no-código** del proyecto: lo que el cliente pidió,
lo que se decidió, y cómo son los datos reales.

## Cómo está organizado

| Carpeta | Qué va acá | ¿Va a git? |
|---|---|---|
| `_inbox/` | Archivos crudos: audio, transcripción, Excels y comprobantes reales del cliente | **No** (tiene datos reales) |
| `reuniones/` | Acta destilada de cada reunión: decisiones, pedidos, pendientes | Sí |
| `requerimientos/` | Un archivo por requerimiento, mapeado a los módulos de la app | Sí |
| `decisiones/` | ADRs: decisiones técnicas y de producto, con su porqué | Sí |
| `modelo-datos/` | Qué campos tienen realmente los Excels y comprobantes del cliente | Sí |

**Regla:** en `_inbox/` entra el material crudo con datos reales (CUIT, nombres, importes).
De ahí sale información destilada y anonimizada hacia el resto. Nada de `_inbox/` se commitea.

## Obsidian

Esta carpeta **es** la vault. No crees una aparte: se desincronizaría en una semana.

> Obsidian → *Open folder as vault* → `D:\dev\PinosSoluciones\docs`

Así tenés grafo, backlinks y búsqueda, pero los archivos siguen versionados en git
y siguen siendo legibles por Claude Code en cada sesión.

### Configuración recomendada

Los enlaces ya funcionan con la configuración por defecto: no hay dos archivos con
el mismo nombre, así que *"ruta más corta cuando sea posible"* los resuelve todos.

Lo único que conviene tocar, en *Configuración → Complementos principales*: activá
*Vista de grafo*, *Vínculos de retroceso*, *Vínculos salientes* y *Esquema*.
Con eso alcanza.

Empezá por [[00-inicio]], que es el índice de todo.

### Qué va acá y qué no

| Va a la vault | No va |
|---|---|
| Requerimientos, decisiones, actas | El código |
| Modelos de negocio y reglas de cálculo | El esquema de la base escrito a mano |
| Glosario del rubro | Datos reales de clientes o personal |

El esquema de la base **se genera desde el código**, no se escribe:

```bash
pnpm docs:schema
```

Eso reescribe [[modelo-datos/esquema-actual]] leyendo los modelos reales de
`src/lib/models.ts`. Documentarlo a mano garantiza que en dos semanas mienta.

## Estado del proyecto

Ver [[PLAN]] para las fases y en qué punto estamos.
