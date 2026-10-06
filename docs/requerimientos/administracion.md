# Administración

Renombra y reorganiza el módulo hoy llamado **Finanzas**. Prioridad 3.

| ID | Requerimiento | Prio |
|---|---|---|
| ADM-1 | Renombrar "Finanzas" a **Administración** | P1 |
| ADM-2 | Agrupar dentro: facturación, cobranzas, pagos, cheques, caja y bancos, **[[personal]]** | P1 |
| ADM-3 | **Compras y gastos también en administración** — administración carga muchos gastos | P1 |
| ADM-4 | **Elegir empresa emisora** al facturar, con numeración propia por empresa | ? |

## Reparto con Compras

| Área | Qué carga |
|---|---|
| **Compras y logística** | Órdenes de compra y facturas de compra de materiales e insumos (dispara ingreso a [[stock]]) |
| **Administración** | Gastos generales, como lo hacen hoy |

## Facturación

Se emite **por fuera del sistema**, en ARCA. Decisión tomada: arrancar con **carga manual** y automatizar más adelante.

Automatizado: las dos empresas tienen su certificado de web services de ARCA y el sistema emite la Factura A y B con CAE al guardarla (o se carga a mano la que salió de Tango). Desde Configuración se prueba la conexión. Las notas de crédito todavía se hacen por fuera. Detalle y alta de certificados: `README.md`, sección "Factura electrónica (ARCA)".

> *"Arranquemos de última manual y después lo vamos puliendo."*

El razonamiento del cliente para empezar manual es operativo, no técnico: quiere que el equipo sepa hacerlo a mano por si el sistema falla algún día.

Ver [[../modelo-datos/cotizacion-pdf]] para los campos fiscales que aparecen en los comprobantes reales (CUIT, neto, IVA, total).
