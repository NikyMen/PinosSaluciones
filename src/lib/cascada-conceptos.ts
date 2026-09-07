import type { OverheadFormula } from "./cascada";

/**
 * El catalogo de gastos generales directos, tal como esta en las 7 planillas.
 *
 * 31 de estos conceptos aparecen con el mismo texto exacto en los 7 libros: es la
 * estructura del negocio, no la decision de una cotizacion. Por eso va hardcodeado
 * y no como coleccion administrable — cuando haga falta editarlo por pantalla se
 * migra, pero hoy no hay nada que administrar.
 *
 * Casi todos van en cero en cualquier obra dada. En POLIUREA solo 8 de 39 tienen
 * valor: la lista es un checklist para no olvidarse, no una lista de costos reales.
 * La pantalla muestra los cargados y pliega el resto.
 *
 * Tres conceptos son formula y no dato tipeado. Ver computeCascade en cascada.ts.
 */

export type ConceptGroupKey = "direccion" | "operativo" | "higiene" | "logistica" | "panolero" | "institucional";

export type Concept = {
  key: string;
  label: string;
  /** Unidad con la que se cuantifica: mes, dia, km, u, juego, gl (global). */
  unit: string;
  formula?: OverheadFormula;
  /** Porcentaje sugerido para los conceptos calculados. */
  formulaPct?: number;
};

export const conceptGroups: { key: ConceptGroupKey; label: string; hint: string; concepts: Concept[] }[] = [
  {
    key: "direccion",
    label: "Dirección de obra",
    hint: "En REVOQUE se desdobla por especialidad: albañilería, cielorrasos, pintura, pintura en altura.",
    concepts: [
      { key: "dir_sueldos", label: "Sueldos / honorarios", unit: "mes" },
      { key: "dir_viaticos", label: "Viáticos", unit: "día" },
      { key: "dir_alojamiento", label: "Alojamiento", unit: "día" },
      { key: "dir_combustible", label: "Combustible de movilidad", unit: "km" },
      { key: "dir_mantenimiento", label: "Mantenimiento vehicular", unit: "km" },
      { key: "dir_pasajes", label: "Pasajes", unit: "u" },
      { key: "dir_movilidad", label: "Gastos varios de movilidad", unit: "gl" },
      { key: "dir_libreria", label: "Librería", unit: "gl" },
      { key: "dir_seguros", label: "Seguros", unit: "mes", formula: "mes_hombre" },
      { key: "dir_epp", label: "Indumentaria y EPP", unit: "juego", formula: "mes_hombre" },
    ],
  },
  {
    key: "operativo",
    label: "Personal operativo",
    hint: "El mismo set de conceptos que dirección de obra, sin librería ni honorarios.",
    concepts: [
      { key: "op_viaticos", label: "Viáticos", unit: "día" },
      { key: "op_alojamiento", label: "Alojamiento", unit: "día" },
      { key: "op_combustible", label: "Combustible de movilidad", unit: "km" },
      { key: "op_mantenimiento", label: "Mantenimiento vehicular", unit: "km" },
      { key: "op_pasajes", label: "Pasajes", unit: "u" },
      { key: "op_movilidad", label: "Gastos varios de movilidad", unit: "gl" },
      { key: "op_seguros", label: "Seguros", unit: "mes", formula: "mes_hombre" },
      { key: "op_epp", label: "Indumentaria y EPP", unit: "juego", formula: "mes_hombre" },
    ],
  },
  {
    key: "higiene",
    label: "Higiene y seguridad",
    hint: "En obras con balancín o silleta esto no es opcional.",
    concepts: [
      { key: "hys_programa", label: "Programa de higiene y seguridad", unit: "gl" },
      { key: "hys_responsable", label: "Sueldos / honorarios del responsable", unit: "mes" },
      { key: "hys_senalizacion", label: "Elementos de señalización", unit: "gl" },
      { key: "hys_permiso", label: "Permiso de obra / uso de vereda", unit: "gl" },
    ],
  },
  {
    key: "logistica",
    label: "Logística y compras",
    hint: "En REVOQUE hay un flete por tipo de material: ladrillos, áridos, bolsas.",
    concepts: [
      { key: "log_fletes", label: "Fletes de materiales", unit: "km" },
      { key: "log_viaticos_chofer", label: "Viáticos de chóferes", unit: "día" },
      { key: "log_alojamiento_chofer", label: "Alojamiento de chóferes", unit: "día" },
      { key: "log_combustible", label: "Combustible del personal de compras", unit: "km" },
      { key: "log_mantenimiento", label: "Mantenimiento vehicular de compras", unit: "km" },
      { key: "log_pasajes", label: "Pasajes del personal de compras", unit: "u" },
      { key: "log_movilidad", label: "Gastos varios de movilidad", unit: "gl" },
      { key: "log_cheque", label: "Impuesto al cheque", unit: "%", formula: "impuesto_cheque", formulaPct: 1 },
    ],
  },
  {
    key: "panolero",
    label: "Pañolero",
    hint: "Está en los 7 libros y en cero en los 7. Se deja porque en obra larga aparece.",
    concepts: [
      { key: "pan_sueldo", label: "Sueldo / honorarios", unit: "mes" },
      { key: "pan_viaticos", label: "Viáticos", unit: "día" },
      { key: "pan_alojamiento", label: "Alojamiento", unit: "día" },
      { key: "pan_movilidad", label: "Gastos de movilidad", unit: "día" },
    ],
  },
  {
    key: "institucional",
    label: "Institucionales",
    hint: "Aparecen cuando la obra sale por licitación.",
    concepts: [
      { key: "ins_sellados", label: "Sellados", unit: "gl" },
      { key: "ins_garantia_oferta", label: "Garantías para la oferta", unit: "gl" },
      { key: "ins_garantia_ejecucion", label: "Garantías para la ejecución", unit: "gl" },
      { key: "ins_fondo_reparo", label: "Fondo de reparo", unit: "gl" },
      { key: "ins_impresiones", label: "Impresiones y librería para ofertas", unit: "gl" },
      { key: "ins_representacion", label: "Representación técnica", unit: "%", formula: "representacion_tecnica", formulaPct: 3 },
    ],
  },
];

export const conceptGroupLabels = Object.fromEntries(conceptGroups.map(group => [group.key, group.label])) as Record<ConceptGroupKey, string>;

/** El catalogo aplanado, en el orden en que se lee en la planilla. */
export const concepts = conceptGroups.flatMap(group => group.concepts.map(concept => ({ ...concept, group: group.key })));

export function findConcept(key: string) {
  return concepts.find(concept => concept.key === key);
}
