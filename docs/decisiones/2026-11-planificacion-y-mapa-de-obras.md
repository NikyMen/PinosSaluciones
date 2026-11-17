# Planificación y mapa de obras

Etapa 6 de la reunión del 10/11/2026.

- El cambio 9118229 retiró de forma expresa el presupuesto del listado. Vuelve para Gerencia y para las personas con el permiso individual **Ver presupuesto de obras**. Gerencia puede asignárselo a Fede en Perfil › Seguridad › Usuarios y permisos. El permiso también controla la exportación del listado.
- La fila muestra el avance real como una línea azul a lo ancho, a 3/4 del alto, y pegada abajo la del avance esperado: días hábiles transcurridos desde el inicio previsto (hasta el fin previsto) sobre la duración prevista. Es verde si el real está a menos de 5 puntos del esperado y naranja si se aparta 5 o más, para arriba o para abajo. Sin fechas previstas o con la obra cancelada no hay línea esperada. El control Estado se compactó. El listado muestra duración en días hábiles.
- Los días hábiles son lunes a viernes y se excluyen los feriados nacionales. El día inicial cuenta si es hábil. Se puede inferir una fecha a partir de la otra y la duración. Perfil › Configuración › Empresas y comprobantes permite editar los feriados por año. La lista inicial de 2026 distingue feriados nacionales de días no laborables turísticos. [Calendario oficial](https://www.argentina.gob.ar/tribunalfiscal/calendario) · [Feriado nacional del 9 de noviembre](https://www.argentina.gob.ar/normativa/nacional/norma-430580/texto)
- En la cotización pueden adjuntarse fotos y cargar dirección, enlace de Google Maps y coordenadas. Al pasar a obra, se copian esos datos. La ubicación se corrige en la obra. Si el enlace contiene coordenadas, se completan al pegarlo. Para un enlace acortado o solo dirección, se pueden completar a mano para que aparezca el marcador.
- **Mapa de obras** está disponible para usuarios con acceso a Obras. Usa Leaflet y OpenStreetMap. Cada marcador muestra estado y avance, con un enlace a la obra. Las obras con dirección o enlace también tienen **Cómo llegar**.

Los campos nuevos son opcionales. Las fechas previstas y reales guardadas se conservan al actualizar.
