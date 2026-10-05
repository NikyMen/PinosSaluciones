/**
 * Todos los registros de una entidad, página por página.
 *
 * La API devuelve como mucho 100 por pedido; un select que se queda con la
 * primera página deja afuera al resto (hay más de 500 clientes). Si un pedido
 * falla, devuelve lo que alcanzó a traer.
 */
export async function fetchAllRecords<T = Record<string, unknown>>(entity: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 100; page++) {
    const response = await fetch(`/api/records/${entity}?limit=100&page=${page}`);
    if (!response.ok) break;
    const result = await response.json() as { items?: T[]; pagination?: { pages?: number } };
    items.push(...(result.items || []));
    if (page >= Number(result.pagination?.pages || 0)) break;
  }
  return items;
}
