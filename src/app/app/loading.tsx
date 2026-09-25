/**
 * Lo que se ve mientras llega una sección. Sin esto, al tocar el menú la
 * pantalla anterior quedaba quieta hasta que el servidor terminaba y parecía
 * que no había pasado nada. Next la muestra al instante y la cambia sola.
 */
export default function Loading() {
  return <div className="page-skeleton" role="status" aria-live="polite" aria-label="Cargando la sección">
    <div className="page-skeleton-heading"><i /><b /><span /></div>
    <div className="page-skeleton-toolbar"><i /><i /></div>
    <div className="page-skeleton-table">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div>
  </div>;
}
