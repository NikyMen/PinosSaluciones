import { describe,expect,it } from "vitest";
import { computeCascade,insumosSummary,parseCoef,solveBenefitPct,targetPriceFromUnitPrice } from "../src/lib/cascada";
import type { CascadeParams,QuoteItem } from "../src/lib/cascada";
import { concepts } from "../src/lib/cascada-conceptos";

/**
 * Los casos son los 7 libros reales del cliente, con los numeros de
 * docs/modelo-datos/cascada-comparativa.md. Si un cambio en la cascada rompe
 * alguno de estos tests, el sistema dejo de darle el mismo numero que el Excel.
 */

const pesos=(monto:number)=>Math.round(monto*100);

/** Un item de una unidad con un solo insumo: sirve para fijar el costo directo exacto. */
const costoDirecto=(mat:number,mo:number,eq=0):QuoteItem[]=>[{
  code:"1.1.",name:"Item unico",unit:"m2",qty:1,
  composition:[
    {rubro:"MAT",name:"Materiales",unit:"gl",coefPerUnit:1,unitPriceCents:pesos(mat)},
    {rubro:"MO",name:"Mano de obra",unit:"gl",coefPerUnit:1,unitPriceCents:pesos(mo)},
    {rubro:"EQUIPOS",name:"Equipos",unit:"gl",coefPerUnit:1,unitPriceCents:pesos(eq)},
  ],
}];

describe("la cascada, paso por paso",()=>{
  // PINTURA EN ALTURA — San Martin 353, 5.250 m2. El caso ancla: los 9 escalones al peso.
  const altura=computeCascade({
    items:costoDirecto(17_113_000,19_636_312.5),
    overheads:[{conceptKey:"dir_sueldos",group:"direccion",label:"Gastos generales directos",unit:"gl",qty:1,unitPriceCents:pesos(3_316_788)}],
    params:{ggiPct:18,benefitPct:30,financialPct:0,iibbPct:2.5,ivaPct:21,ivaBase:"st2",chequePct:0},
  });

  it("1 · suma el costo directo por rubro",()=>{
    expect(altura.materialsCents).toBe(pesos(17_113_000));
    expect(altura.laborCents).toBe(pesos(19_636_312.5));
    expect(altura.directCostCents).toBe(pesos(36_749_312.5));
  });
  it("2 y 3 · suma los gastos generales directos al costo",()=>{
    expect(altura.ggdCents).toBe(pesos(3_316_788));
    expect(altura.costCents).toBe(pesos(40_066_100.5));
  });
  it("4 y 5 · aplica el 18 % de indirectos sobre el costo",()=>{
    expect(altura.ggiCents).toBe(pesos(7_211_898.09));
    expect(altura.subtotal1Cents).toBe(pesos(47_277_998.59));
  });
  it("6 y 7 · aplica el 30 % de beneficio sobre el subtotal 1, no sobre el costo",()=>{
    expect(altura.benefitCents).toBe(pesos(14_183_399.58));
    expect(altura.subtotal2Cents).toBe(pesos(61_461_398.17));
  });
  it("8 · aplica 2,5 % de ingresos brutos sobre el subtotal 2",()=>{
    expect(altura.iibbCents).toBe(pesos(1_536_534.95));
    expect(altura.subtotal3Cents).toBe(pesos(62_997_933.12));
  });
  it("9 · llega al precio final del cliente",()=>{
    expect(altura.ivaCents).toBe(pesos(12_906_893.62));
    expect(altura.priceCents).toBeCloseTo(pesos(75_904_826.75),-2);
  });
  it("calcula el coeficiente k, que es lo que despues multiplica cada item",()=>{
    expect(altura.k).toBeCloseTo(2.065,3);
  });
  it("no agrega el +0,01 de desempate que tienen 5 de los 7 libros",()=>{
    expect(altura.priceCents).toBe(altura.subtotal3Cents+altura.ivaCents);
  });
});

describe("la base del IVA cambia el precio",()=>{
  const base=(ivaBase:"st2"|"st3")=>computeCascade({
    items:costoDirecto(17_113_000,19_636_312.5),
    overheads:[{conceptKey:"x",group:"direccion",label:"GGD",unit:"gl",qty:1,unitPriceCents:pesos(3_316_788)}],
    params:{ivaBase},
  });
  it("sobre el subtotal 3 da 322.672 pesos mas que sobre el 2, en la misma cotizacion",()=>{
    const diferencia=(base("st3").priceCents-base("st2").priceCents)/100;
    expect(Math.round(diferencia)).toBe(322_672);
  });
});

/** Los 7 libros: costo directo, gastos generales como % del costo directo, beneficio, base del IVA y el k que dio. */
const libros:{nombre:string;directo:number;ggdPct:number;params:Partial<CascadeParams>;k:number}[]=[
  {nombre:"PINTURA EN ALTURA",directo:36_749_313,ggdPct:9.025,params:{benefitPct:30},k:2.065},
  {nombre:"PINTURA INTERIOR",directo:54_149_125,ggdPct:7.3,params:{benefitPct:30},k:2.033},
  {nombre:"POLIUREA 9 DE JULIO",directo:7_475_212,ggdPct:5.9,params:{benefitPct:34.777129088592147},k:2.081},
  {nombre:"POLIURETANO",directo:10_425_956,ggdPct:10.2,params:{benefitPct:30},k:2.088},
  {nombre:"REVOQUE EXTERIOR",directo:8_575_147,ggdPct:30.4,params:{benefitPct:30,ivaBase:"st3"},k:2.481},
  {nombre:"BREAR REVOQUE INT.",directo:9_635_963,ggdPct:3.8,params:{benefitPct:25},k:1.892},
  {nombre:"IMPERMEABILIZACIÓN",directo:11_984_955,ggdPct:6.8,params:{benefitPct:30},k:2.023},
];

describe("los 7 libros del cliente",()=>{
  for(const libro of libros){
    it(`${libro.nombre} da k ${libro.k}`,()=>{
      const resultado=computeCascade({
        items:costoDirecto(libro.directo,0),
        overheads:[{conceptKey:"x",group:"direccion",label:"GGD",unit:"gl",qty:1,unitPriceCents:pesos(libro.directo*libro.ggdPct/100)}],
        params:libro.params,
      });
      expect(resultado.k).toBeCloseTo(libro.k,2);
    });
  }
});

describe("el analisis de precios",()=>{
  const item:QuoteItem={
    code:"1.1.",name:"Pintura de fachada",unit:"m2",qty:5250,
    composition:[
      {rubro:"MAT",name:"Látex acrílico",unit:"lts",coefPerUnit:0.4,unitPriceCents:pesos(8_000)},
      {rubro:"MO",name:"Oficial pintor",unit:"hs",coefPerUnit:0.5,unitPriceCents:pesos(6_000),personas:7},
    ],
  };
  const resultado=computeCascade({items:[item]});

  it("multiplica el coeficiente de consumo por la cantidad de obra",()=>{
    expect(resultado.materialsCents).toBe(pesos(0.4*5250*8_000));
    expect(resultado.laborCents).toBe(pesos(0.5*5250*6_000));
  });
  it("el costo unitario del item es la suma de sus insumos",()=>{
    expect(resultado.items[0].unitCostCents).toBe(pesos(0.4*8_000+0.5*6_000));
  });
  it("el precio del item es su costo unitario por k, no otra cascada",()=>{
    expect(resultado.items[0].unitPriceCents).toBe(Math.round(resultado.items[0].unitCostCents*resultado.k));
    expect(resultado.items[0].priceCents).toBeCloseTo(resultado.priceCents,-2);
  });
  it("saca la dotacion de las horas de mano de obra cargadas",()=>{
    expect(resultado.dotacion.horas).toBe(0.5*5250);
    expect(resultado.dotacion.dias).toBeCloseTo(0.5*5250/8,1);
    expect(resultado.dotacion.personas).toBe(7);
  });
  it("los materiales en dolares se pasan a pesos con la cotizacion congelada",()=>{
    const dolarizado=computeCascade({items:[{name:"Poliurea",unit:"m2",qty:1,composition:[
      {rubro:"MAT",name:"Espuma",unit:"kg",coefPerUnit:1,unitPriceCents:pesos(13),currency:"USD",fxRate:1520},
    ]}]});
    expect(dolarizado.materialsCents).toBe(pesos(13*1520));
  });
});

describe("los gastos generales que son formula",()=>{
  const items=costoDirecto(10_000_000,5_000_000);
  it("el impuesto al cheque es un porcentaje sobre los materiales, no sobre el costo",()=>{
    const resultado=computeCascade({items,overheads:[{conceptKey:"log_cheque",group:"logistica",label:"Impuesto al cheque",unit:"%",qty:0,unitPriceCents:0,formula:"impuesto_cheque",formulaPct:1.2}],params:{}});
    expect(resultado.ggdCents).toBe(pesos(10_000_000*0.012));
  });
  it("la representacion tecnica es un porcentaje sobre el costo directo",()=>{
    const resultado=computeCascade({items,overheads:[{conceptKey:"ins_representacion",group:"institucional",label:"Representación técnica",unit:"%",qty:0,unitPriceCents:0,formula:"representacion_tecnica",formulaPct:3}]});
    expect(resultado.ggdCents).toBe(pesos(15_000_000*0.03));
  });
  it("el prorrateo mes-hombre reemplaza el =7*78/25 que hacen a mano",()=>{
    const resultado=computeCascade({items,overheads:[{conceptKey:"op_seguros",group:"operativo",label:"Seguros",unit:"mes",qty:0,unitPriceCents:pesos(100_000),formula:"mes_hombre",personas:7,dias:78}]});
    expect(resultado.overheads[0].computedQty).toBeCloseTo(7*78/25,2);
    expect(resultado.ggdCents).toBe(Math.round(pesos(100_000)*7*78/25));
  });
});

describe("el modo inverso: fijo el precio y despejo el beneficio",()=>{
  const entrada={
    items:costoDirecto(7_244_955,230_257),
    overheads:[{conceptKey:"x",group:"direccion",label:"GGD",unit:"gl",qty:1,unitPriceCents:pesos(441_037)}],
  };
  it("vuelve exactamente al beneficio con el que se calculo el precio",()=>{
    const params={benefitPct:34.777129088592147};
    const precio=computeCascade({...entrada,params}).priceCents;
    expect(solveBenefitPct({...entrada,params},precio)).toBeCloseTo(34.777129088592147,6);
  });
  it("con el precio redondo de POLIUREA da el beneficio raro que quedo en la planilla",()=>{
    expect(solveBenefitPct(entrada,pesos(15_555_000))).toBeCloseTo(34.8,0);
  });
  it("fijar el precio unitario de un item fija el de toda la cotizacion, porque k es uno solo",()=>{
    const resultado=computeCascade(entrada);
    const objetivo=targetPriceFromUnitPrice(resultado,0,pesos(91_500));
    expect(objetivo).not.toBeNull();
    const conNuevoBeneficio=computeCascade({...entrada,params:{benefitPct:solveBenefitPct(entrada,objetivo as number) as number}});
    expect(conNuevoBeneficio.items[0].unitPriceCents).toBeCloseTo(pesos(91_500),-2);
  });
  it("avisa con un beneficio negativo cuando el precio pedido no cubre el costo",()=>{
    expect(solveBenefitPct(entrada,pesos(1_000_000))).toBeLessThan(0);
  });
  it("no despeja nada si todavia no hay costo cargado",()=>{
    expect(solveBenefitPct({items:[]},pesos(1_000_000))).toBeNull();
  });
});

describe("el coeficiente de consumo se carga como lo piensa la gente",()=>{
  it("acepta el coeficiente derecho",()=>{expect(parseCoef("0,4")).toBe(0.4)});
  it("acepta el total dividido la superficie, que es como esta en las planillas",()=>{expect(parseCoef("80/5250")).toBeCloseTo(80/5250,10)});
  it("acepta las horas cada tantos metros",()=>{expect(parseCoef("8/15")).toBeCloseTo(8/15,10)});
  it("aguanta que venga con el = de Excel adelante",()=>{expect(parseCoef("=8/15")).toBeCloseTo(8/15,10)});
  it("no explota con basura ni con una division por cero",()=>{expect(parseCoef("")).toBe(0);expect(parseCoef("hola")).toBe(0);expect(parseCoef("8/0")).toBe(0)});
});

describe("la lista de compras",()=>{
  it("agrupa el mismo insumo aunque este en items distintos",()=>{
    const resultado=computeCascade({items:[
      {name:"Item A",unit:"m2",qty:100,composition:[{rubro:"MAT",name:"Látex",unit:"lts",coefPerUnit:0.4,unitPriceCents:pesos(8_000)}]},
      {name:"Item B",unit:"m2",qty:50,composition:[{rubro:"MAT",name:"látex",unit:"LTS",coefPerUnit:0.4,unitPriceCents:pesos(8_000)}]},
    ]});
    const insumos=insumosSummary(resultado);
    expect(insumos).toHaveLength(1);
    expect(insumos[0].totalQty).toBe(60);
  });
});

describe("el catalogo de gastos generales",()=>{
  it("tiene los 6 bloques de las planillas y ningun concepto repetido",()=>{
    expect(concepts.length).toBeGreaterThanOrEqual(31);
    expect(new Set(concepts.map(concept=>concept.key)).size).toBe(concepts.length);
  });
  it("marca como calculados los tres que en las planillas son formula",()=>{
    expect(concepts.filter(concept=>concept.formula).map(concept=>concept.formula)).toContain("impuesto_cheque");
    expect(concepts.filter(concept=>concept.formula).map(concept=>concept.formula)).toContain("representacion_tecnica");
    expect(concepts.filter(concept=>concept.formula).map(concept=>concept.formula)).toContain("mes_hombre");
  });
});
