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

No hace falta una vault aparte. Abrí **esta carpeta** (`docs/`) como vault en Obsidian:

> Obsidian → *Open folder as vault* → `D:\dev\PinosSoluciones\docs`

Con eso tenés el grafo, los backlinks y el modo lectura, pero los archivos siguen
versionados en git y siguen siendo legibles por Claude Code en cada sesión.
Una vault separada duplicaría el trabajo y se desincronizaría en una semana.

Convención de enlaces: `[[nombre-del-archivo]]` (sin extensión), igual que en Obsidian.

## Estado del proyecto

Ver [[PLAN]] para las fases y en qué punto estamos.
