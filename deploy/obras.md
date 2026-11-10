# Fechas y estado de obra

El listado y la edición de Obras reemplazan el presupuesto por las fechas previstas y reales. `startDate` y `endDate` conservan su valor y representan las previstas; `actualStartDate` y `actualEndDate` son opcionales. El presupuesto interno se conserva para certificación y facturación. No requiere migración ni cambia obras existentes durante el deploy.

Aplicar el procedimiento de actualización del README con pnpm y recarga de PM2. Antes de actualizar, verificar el dominio con `nslookup pinosoluciones.consultoriadigital.io` y hacer el backup manual documentado.

Validar en pruebas: alta sin presupuesto, cuatro fechas, rechazo de fin anterior al inicio, limpieza de fechas opcionales, avance 0–100 % y conservación de importes existentes. Estado de obra permite avance manual sólo sin base de inspecciones. Con base, sigue el cálculo automático. Al 50 %, la mitad de la fila queda roja, también al pasar el mouse y en móvil. No crear registros de prueba en producción.
