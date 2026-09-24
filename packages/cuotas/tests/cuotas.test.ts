import { describe, it, expect } from "vitest";
import { sumarCentavos } from "@mafesoftware/plata-ar";
import {
  SIN_RECARGO,
  calcularRecargo,
  diasDeAtraso,
  emitirPeriodo,
  imputarPago,
  prorratear,
  resumirDeuda,
  saldo,
  totalAPagar,
  type Deuda,
  type EsquemaRecargo,
  vencimientosDe,
} from "../src/index.ts";

const d = (over: Partial<Deuda> & Pick<Deuda, "id" | "vencimiento" | "importe">): Deuda => over;

/** Primer vencimiento sin recargo, segundo (a los 10 dias) con 10%. */
const ESCALONADO: EsquemaRecargo = {
  escalones: [
    { diasVencido: 1, porcentaje: 0 },
    { diasVencido: 10, porcentaje: 10 },
  ],
};

describe("saldo", () => {
  it("importe menos pagado", () => {
    expect(saldo(d({ id: "a", vencimiento: "2026-09-10", importe: 100000, pagado: 30000 }))).toBe(70000);
  });
  it("nunca negativo, aunque alguien haya pagado de mas", () => {
    expect(saldo(d({ id: "a", vencimiento: "2026-09-10", importe: 100000, pagado: 150000 }))).toBe(0);
  });
  it("una deuda anulada no se debe", () => {
    expect(saldo(d({ id: "a", vencimiento: "2026-09-10", importe: 100000, anulada: true }))).toBe(0);
  });
  it("sin pagado, se debe todo", () => {
    expect(saldo(d({ id: "a", vencimiento: "2026-09-10", importe: 100000 }))).toBe(100000);
  });
});

describe("diasDeAtraso", () => {
  const cuota = d({ id: "a", vencimiento: "2026-09-10", importe: 100000 });
  it("cero el MISMO dia del vencimiento: pagar el 10 es pagar en termino", () => {
    // Corrido por uno, esto le cobra recargo a todo un club el dia 10.
    expect(diasDeAtraso(cuota, "2026-09-10")).toBe(0);
  });
  it("cero antes del vencimiento", () => {
    expect(diasDeAtraso(cuota, "2026-09-01")).toBe(0);
  });
  it("uno al dia siguiente", () => {
    expect(diasDeAtraso(cuota, "2026-09-11")).toBe(1);
  });
  it("cuenta cruzando el fin de mes", () => {
    expect(diasDeAtraso(cuota, "2026-10-10")).toBe(30);
  });
});

describe("calcularRecargo", () => {
  const cuota = d({ id: "a", vencimiento: "2026-09-10", importe: 100000 });

  it("sin esquema no hay recargo, aunque deba dos anos", () => {
    expect(calcularRecargo(cuota, "2028-09-10", SIN_RECARGO)).toBe(0);
  });
  it("en termino no hay recargo", () => {
    expect(calcularRecargo(cuota, "2026-09-10", ESCALONADO)).toBe(0);
  });
  it("entre el primer y el segundo vencimiento, tampoco", () => {
    expect(calcularRecargo(cuota, "2026-09-15", ESCALONADO)).toBe(0);
  });
  it("pasado el segundo vencimiento, el 10%", () => {
    expect(calcularRecargo(cuota, "2026-09-20", ESCALONADO)).toBe(10000);
  });
  it("aplica UN escalon, el mayor cumplido, no la suma", () => {
    const acumulativo: EsquemaRecargo = {
      escalones: [
        { diasVencido: 1, porcentaje: 5 },
        { diasVencido: 10, porcentaje: 10 },
      ],
    };
    // 10%, no 15%.
    expect(calcularRecargo(cuota, "2026-09-25", acumulativo)).toBe(10000);
  });
  it("los escalones se ordenan solos aunque vengan al reves", () => {
    const desordenado: EsquemaRecargo = {
      escalones: [
        { diasVencido: 10, porcentaje: 10 },
        { diasVencido: 1, porcentaje: 5 },
      ],
    };
    expect(calcularRecargo(cuota, "2026-09-25", desordenado)).toBe(10000);
    expect(calcularRecargo(cuota, "2026-09-12", desordenado)).toBe(5000);
  });
  it("porcentaje diario acumula", () => {
    const diario: EsquemaRecargo = { porcentajeDiario: 1 };
    expect(calcularRecargo(cuota, "2026-09-15", diario)).toBe(5000); // 5 dias x 1%
  });
  it("dias de gracia corren el arranque", () => {
    const conGracia: EsquemaRecargo = { porcentajeDiario: 1, diasDeGracia: 5 };
    expect(calcularRecargo(cuota, "2026-09-15", conGracia)).toBe(0);
    expect(calcularRecargo(cuota, "2026-09-18", conGracia)).toBe(3000);
  });
  it("el tope frena la fantasia de una deuda de dos anos", () => {
    const conTope: EsquemaRecargo = { porcentajeDiario: 1, topePorcentaje: 50 };
    // Sin tope serian 730 dias x 1% = 730% de recargo.
    expect(calcularRecargo(cuota, "2028-09-10", conTope)).toBe(50000);
  });
  it("se calcula sobre el SALDO, no sobre el importe original", () => {
    const media = d({ id: "a", vencimiento: "2026-09-10", importe: 100000, pagado: 50000 });
    expect(calcularRecargo(media, "2026-09-20", ESCALONADO)).toBe(5000);
  });
  it("una deuda saldada no devenga", () => {
    const paga = d({ id: "a", vencimiento: "2026-09-10", importe: 100000, pagado: 100000 });
    expect(calcularRecargo(paga, "2026-12-31", ESCALONADO)).toBe(0);
  });
  it("una deuda anulada no devenga", () => {
    const anulada = d({ id: "a", vencimiento: "2026-09-10", importe: 100000, anulada: true });
    expect(calcularRecargo(anulada, "2026-12-31", ESCALONADO)).toBe(0);
  });
  it("totalAPagar es saldo mas recargo", () => {
    expect(totalAPagar(cuota, "2026-09-20", ESCALONADO)).toBe(110000);
  });
});

describe("resumirDeuda: lo que decide si el molinete abre", () => {
  const hoy = "2026-09-20";
  const vencida = d({ id: "ago", vencimiento: "2026-08-10", importe: 100000 });
  const porVencer = d({ id: "oct", vencimiento: "2026-10-10", importe: 100000 });

  it("sin deudas, al dia", () => {
    const r = resumirDeuda([], hoy);
    expect(r.estado).toBe("al_dia");
    expect(r.saldoTotal).toBe(0);
    expect(r.periodosVencidos).toBe(0);
  });
  it("una cuota que todavia no vencio NO es morosidad", () => {
    const r = resumirDeuda([porVencer], hoy);
    expect(r.estado).toBe("al_dia");
    expect(r.saldoTotal).toBe(100000);
    expect(r.vencidoConRecargo).toBe(0);
  });
  it("una cuota vencida si", () => {
    const r = resumirDeuda([vencida], hoy);
    expect(r.estado).toBe("moroso");
    expect(r.periodosVencidos).toBe(1);
  });
  it("la tolerancia en dias evita que el 11 no entre medio club", () => {
    const reciente = d({ id: "sep", vencimiento: "2026-09-18", importe: 100000 });
    expect(resumirDeuda([reciente], hoy, { toleranciaDias: 5 }).estado).toBe("al_dia");
    expect(resumirDeuda([reciente], hoy, { toleranciaDias: 1 }).estado).toBe("moroso");
  });
  it("la tolerancia en periodos: se corta recien debiendo dos", () => {
    const dos = [vencida, d({ id: "jul", vencimiento: "2026-07-10", importe: 100000 })];
    expect(resumirDeuda([vencida], hoy, { toleranciaPeriodos: 1 }).estado).toBe("al_dia");
    expect(resumirDeuda(dos, hoy, { toleranciaPeriodos: 1 }).estado).toBe("moroso");
  });
  it("deber dos cuotas de las cuales una no vencio no es deber dos cuotas", () => {
    const r = resumirDeuda([vencida, porVencer], hoy, { toleranciaPeriodos: 1 });
    expect(r.estado).toBe("al_dia");
    expect(r.periodosVencidos).toBe(1);
  });
  it("separa el total del vencido", () => {
    const r = resumirDeuda([vencida, porVencer], hoy, { esquema: ESCALONADO });
    expect(r.saldoTotal).toBe(200000);
    expect(r.totalConRecargo).toBe(210000); // solo la vencida recarga
    expect(r.vencidoConRecargo).toBe(110000);
  });
  it("las deudas saldadas y anuladas no cuentan", () => {
    const r = resumirDeuda(
      [
        d({ id: "a", vencimiento: "2026-01-10", importe: 100000, pagado: 100000 }),
        d({ id: "b", vencimiento: "2026-01-10", importe: 100000, anulada: true }),
      ],
      hoy
    );
    expect(r.estado).toBe("al_dia");
    expect(r.saldoTotal).toBe(0);
  });
  it("informa el atraso de la mas vieja", () => {
    const r = resumirDeuda([vencida, d({ id: "may", vencimiento: "2026-05-10", importe: 1 })], hoy);
    expect(r.diasDeAtrasoMaximo).toBe(133);
  });
});

describe("imputarPago", () => {
  const hoy = "2026-09-20";
  const deudas = [
    d({ id: "jul", vencimiento: "2026-07-10", importe: 100000 }),
    d({ id: "ago", vencimiento: "2026-08-10", importe: 100000 }),
    d({ id: "sep", vencimiento: "2026-09-10", importe: 100000 }),
  ];

  it("las mas viejas primero", () => {
    const r = imputarPago(100000, deudas, { hoy });
    expect(r.imputaciones).toHaveLength(1);
    expect(r.imputaciones[0]!.deudaId).toBe("jul");
  });

  it("no pierde ni inventa un centavo, nunca", () => {
    for (const importe of [1, 99999, 100000, 250000, 300000, 999999, 1234567]) {
      const r = imputarPago(importe, deudas, { hoy, esquema: ESCALONADO });
      expect(r.aplicado + r.aFavor).toBe(importe);
      expect(sumarCentavos(r.imputaciones.map((i) => i.total))).toBe(r.aplicado);
      for (const i of r.imputaciones) expect(i.aCapital + i.aRecargo).toBe(i.total);
    }
  });

  it("lo que sobra queda a favor, no se evapora", () => {
    const r = imputarPago(500000, deudas, { hoy });
    expect(r.aplicado).toBe(300000);
    expect(r.aFavor).toBe(200000);
  });

  it("dentro de una deuda, primero el recargo", () => {
    // Si no, manana el recargo se recalcula sobre otro capital y el numero
    // que el socio vio hoy ya no existe.
    const una = [d({ id: "jul", vencimiento: "2026-07-10", importe: 100000 })];
    const r = imputarPago(5000, una, { hoy, esquema: ESCALONADO });
    expect(r.imputaciones[0]).toMatchObject({ aRecargo: 5000, aCapital: 0, cancelada: false });
  });

  it("cancela cuando alcanza para capital mas recargo", () => {
    const una = [d({ id: "jul", vencimiento: "2026-07-10", importe: 100000 })];
    const r = imputarPago(110000, una, { hoy, esquema: ESCALONADO });
    expect(r.imputaciones[0]).toMatchObject({ aRecargo: 10000, aCapital: 100000, cancelada: true });
    expect(r.aFavor).toBe(0);
  });

  it("un pago parcial imputa lo que hay", () => {
    const r = imputarPago(150000, deudas, { hoy });
    expect(r.imputaciones).toHaveLength(2);
    expect(r.imputaciones[0]).toMatchObject({ deudaId: "jul", total: 100000, cancelada: true });
    expect(r.imputaciones[1]).toMatchObject({ deudaId: "ago", total: 50000, cancelada: false });
  });

  it("soloCancelaciones no deja cuotas medio pagas", () => {
    // Un debito automatico parcial no existe; aceptarlo deja una cuota que
    // ningun proceso vuelve a mirar.
    const r = imputarPago(150000, deudas, { hoy, soloCancelaciones: true });
    expect(r.imputaciones).toHaveLength(1);
    expect(r.imputaciones[0]!.cancelada).toBe(true);
    expect(r.aFavor).toBe(50000);
  });

  it("soloCancelaciones saltea la cara y cancela la siguiente que entre", () => {
    const mixtas = [
      d({ id: "cara", vencimiento: "2026-07-10", importe: 500000 }),
      d({ id: "barata", vencimiento: "2026-08-10", importe: 100000 }),
    ];
    const r = imputarPago(100000, mixtas, { hoy, soloCancelaciones: true });
    expect(r.imputaciones.map((i) => i.deudaId)).toEqual(["barata"]);
  });

  it("soloDeudas respeta el orden pedido: pagar una cuota puntual", () => {
    const r = imputarPago(100000, deudas, { hoy, soloDeudas: ["sep"] });
    expect(r.imputaciones[0]!.deudaId).toBe("sep");
  });

  it("soloDeudas ignora ids que no existen o ya estan pagos", () => {
    const r = imputarPago(100000, deudas, { hoy, soloDeudas: ["inventada", "ago"] });
    expect(r.imputaciones.map((i) => i.deudaId)).toEqual(["ago"]);
  });

  it("un importe de cero o negativo no imputa nada", () => {
    expect(imputarPago(0, deudas, { hoy }).imputaciones).toHaveLength(0);
    expect(imputarPago(-500, deudas, { hoy }).imputaciones).toHaveLength(0);
  });

  it("sin deudas, todo queda a favor", () => {
    const r = imputarPago(100000, [], { hoy });
    expect(r.aFavor).toBe(100000);
    expect(r.aplicado).toBe(0);
  });

  it("no toca deudas anuladas ni saldadas", () => {
    const r = imputarPago(500000, [
      d({ id: "anul", vencimiento: "2026-01-10", importe: 100000, anulada: true }),
      d({ id: "paga", vencimiento: "2026-02-10", importe: 100000, pagado: 100000 }),
      d({ id: "viva", vencimiento: "2026-03-10", importe: 100000 }),
    ], { hoy });
    expect(r.imputaciones.map((i) => i.deudaId)).toEqual(["viva"]);
  });

  it("dos deudas del mismo dia se imputan SIEMPRE en el mismo orden", () => {
    // Sin desempate, el mismo pago da dos resultados y la conciliacion no cierra.
    const empatadas = [
      d({ id: "zzz", vencimiento: "2026-07-10", importe: 100000 }),
      d({ id: "aaa", vencimiento: "2026-07-10", importe: 100000 }),
    ];
    const a = imputarPago(100000, empatadas, { hoy });
    const b = imputarPago(100000, [...empatadas].reverse(), { hoy });
    expect(a.imputaciones[0]!.deudaId).toBe("aaa");
    expect(b.imputaciones[0]!.deudaId).toBe("aaa");
  });

  it("imputar el total con recargo deja al socio en cero", () => {
    const antes = resumirDeuda(deudas, hoy, { esquema: ESCALONADO });
    const r = imputarPago(antes.totalConRecargo, deudas, { hoy, esquema: ESCALONADO });
    expect(r.aFavor).toBe(0);
    expect(r.imputaciones.every((i) => i.cancelada)).toBe(true);
  });
});

describe("prorratear", () => {
  const septiembre = { desdeISO: "2026-09-01", hastaISO: "2026-09-30" };

  it("un socio de todo el mes paga la cuota entera", () => {
    expect(prorratear(300000, septiembre)).toBe(300000);
  });
  it("un socio que se asocia el 20 paga 11 de 30 dias, el 20 incluido", () => {
    expect(prorratear(300000, { ...septiembre, altaISO: "2026-09-20" })).toBe(110000);
  });
  it("un alta anterior al periodo no prorratea", () => {
    expect(prorratear(300000, { ...septiembre, altaISO: "2026-01-15" })).toBe(300000);
  });
  it("una baja a mitad de mes corta", () => {
    expect(prorratear(300000, { ...septiembre, bajaISO: "2026-09-10" })).toBe(100000);
  });
  it("baja antes del periodo: no paga nada", () => {
    expect(prorratear(300000, { ...septiembre, bajaISO: "2026-08-15" })).toBe(0);
  });
  it("la suma de los tramos de un mes da EXACTAMENTE la cuota, cortando donde sea", () => {
    // Multiplicar y redondear cada tramo dejaria un centavo colgado; tomar
    // "los primeros N dias" en vez del tramo propio duplica los sobrantes.
    for (const importe of [100001, 300000, 1, 99, 123457, 555555]) {
      for (let corte = 1; corte <= 29; corte++) {
        const dia = String(corte).padStart(2, "0");
        const siguiente = String(corte + 1).padStart(2, "0");
        const primero = prorratear(importe, { ...septiembre, bajaISO: `2026-09-${dia}` });
        const segundo = prorratear(importe, { ...septiembre, altaISO: `2026-09-${siguiente}` });
        expect(primero + segundo).toBe(importe);
      }
    }
  });

  it("tres tramos tampoco pierden ni inventan un centavo", () => {
    const importe = 100001;
    const a = prorratear(importe, { ...septiembre, bajaISO: "2026-09-09" });
    const b = prorratear(importe, { ...septiembre, altaISO: "2026-09-10", bajaISO: "2026-09-19" });
    const c = prorratear(importe, { ...septiembre, altaISO: "2026-09-20" });
    expect(a + b + c).toBe(importe);
  });
  it("un periodo invertido da cero en vez de un numero raro", () => {
    expect(prorratear(300000, { desdeISO: "2026-09-30", hastaISO: "2026-09-01" })).toBe(0);
  });
  it("febrero de 28 dias", () => {
    const feb = { desdeISO: "2026-02-01", hastaISO: "2026-02-28" };
    expect(prorratear(280000, { ...feb, altaISO: "2026-02-15" })).toBe(140000);
  });
});

describe("emitirPeriodo", () => {
  const periodo = { desdeISO: "2026-09-01", hastaISO: "2026-09-30" };

  it("emite una cuota por socio", () => {
    const c = emitirPeriodo([{ id: "a", importe: 300000 }, { id: "b", importe: 500000 }], periodo);
    expect(c.map((x) => x.importe)).toEqual([300000, 500000]);
  });

  it("el desglose explica el numero", () => {
    const [c] = emitirPeriodo(
      [{ id: "a", importe: 300000, ajustes: [{ concepto: "Natación", importe: 150000 }] }],
      periodo
    );
    expect(c!.importe).toBe(450000);
    expect(c!.renglones).toEqual([
      { concepto: "Cuota social", importe: 300000 },
      { concepto: "Natación", importe: 150000 },
    ]);
    expect(sumarCentavos(c!.renglones.map((r) => r.importe))).toBe(c!.importe);
  });

  it("el titular paga entera y el segundo integrante lleva el descuento", () => {
    const c = emitirPeriodo(
      [
        { id: "titular", importe: 300000, grupoFamiliarId: "g1" },
        { id: "hijo", importe: 300000, grupoFamiliarId: "g1" },
      ],
      { ...periodo, descuentoFamiliarPorcentaje: 50 }
    );
    expect(c[0]!.importe).toBe(300000);
    expect(c[1]!.importe).toBe(150000);
  });

  it("un socio solo en su grupo no lleva descuento", () => {
    const c = emitirPeriodo(
      [{ id: "solo", importe: 300000, grupoFamiliarId: "g1" }],
      { ...periodo, descuentoFamiliarPorcentaje: 50 }
    );
    expect(c[0]!.importe).toBe(300000);
  });

  it("el descuento no depende del orden de la lista", () => {
    // Contar mientras se emite haria que el primero nunca lo tenga.
    const socios = [
      { id: "a", importe: 300000, grupoFamiliarId: "g1" },
      { id: "b", importe: 300000, grupoFamiliarId: "g1" },
      { id: "c", importe: 300000, grupoFamiliarId: "g1" },
    ];
    const c = emitirPeriodo(socios, { ...periodo, descuentoFamiliarPorcentaje: 50 });
    expect(c.map((x) => x.importe)).toEqual([300000, 150000, 150000]);
  });

  it("prorratea al que se asocia a mitad de periodo", () => {
    const c = emitirPeriodo(
      [{ id: "a", importe: 300000, altaEnElPeriodo: "2026-09-20" }],
      periodo
    );
    expect(c[0]!.importe).toBe(110000);
  });

  it("no emite cuota al que no estuvo activo ni un dia", () => {
    const c = emitirPeriodo([{ id: "a", importe: 300000, bajaEnElPeriodo: "2026-08-01" }], periodo);
    expect(c).toHaveLength(0);
  });

  it("una cuota nunca queda negativa", () => {
    // Un descuento mas grande que la cuota seria plata que el club le debe al
    // socio sin que nadie lo haya decidido.
    const c = emitirPeriodo(
      [{ id: "a", importe: 100000, ajustes: [{ concepto: "Bonificación", importe: -500000 }] }],
      periodo
    );
    expect(c[0]!.importe).toBe(0);
  });

  it("sin descuento familiar configurado, nadie lo lleva", () => {
    const c = emitirPeriodo(
      [
        { id: "a", importe: 300000, grupoFamiliarId: "g1" },
        { id: "b", importe: 300000, grupoFamiliarId: "g1" },
      ],
      periodo
    );
    expect(c.map((x) => x.importe)).toEqual([300000, 300000]);
  });
});

describe("vencimientosDe", () => {
  it("solo el primero cuando no hay segundo", () => {
    expect(vencimientosDe("2026-09-10")).toEqual({ primero: "2026-09-10" });
    expect(vencimientosDe("2026-09-10", 0)).toEqual({ primero: "2026-09-10" });
  });
  it("el segundo cae a los N dias", () => {
    expect(vencimientosDe("2026-09-10", 10)).toEqual({
      primero: "2026-09-10",
      segundo: "2026-09-20",
    });
  });
  it("cruza el fin de mes", () => {
    expect(vencimientosDe("2026-09-25", 10).segundo).toBe("2026-10-05");
  });
});

describe("el recargo se cobra UNA vez, no en cada pago parcial", () => {
  /**
   * El recargo del club es un porcentaje PLANO que arranca pasado el segundo
   * vencimiento: "10% de la cuota". No es un interés diario.
   *
   * Se calculaba sobre el saldo y sin mirar lo ya cobrado, así que un pago
   * parcial lo volvía a disparar:
   *
   *     cuota 100000, recargo 10%       -> debe 110000
   *     paga 55000 (cubre el recargo)   -> capital restante 55000
   *     recargo NUEVO 10% de 55000      -> debe 60500
   *                                        total 115500, no 110000
   *
   * Y compone: cada pago parcial vuelve a agregar recargo sobre lo que queda.
   * El socio que no puede pagar todo de una es exactamente el que más lo sufre.
   *
   * La regla ahora: el recargo se calcula sobre lo que se debe, y **nunca supera
   * el porcentaje de la cuota entera** menos lo que ya se cobró de recargo.
   */
  const ESQUEMA = { escalones: [{ diasVencido: 1, porcentaje: 10 }] };
  const HOY = "2027-03-01";
  const VENCIDA = "2027-01-10";

  it("sin pagos, el recargo es el porcentaje de la cuota", () => {
    expect(calcularRecargo({ id: "c", vencimiento: VENCIDA, importe: 100_000 }, HOY, ESQUEMA)).toBe(10_000);
  });

  it("con el recargo ya cobrado, no se vuelve a cobrar", () => {
    const d = { id: "c", vencimiento: VENCIDA, importe: 100_000, pagado: 45_000, recargoCobrado: 10_000 };
    expect(calcularRecargo(d, HOY, ESQUEMA)).toBe(0);
    // Y lo que falta es exactamente el capital que queda.
    expect(totalAPagar(d, HOY, ESQUEMA)).toBe(55_000);
  });

  it("el total que termina pagando es la cuota más UN recargo, pague en una o en tres veces", () => {
    // La afirmación que importa: pagar en cuotas no puede costar más.
    const deUnaVez = totalAPagar({ id: "c", vencimiento: VENCIDA, importe: 100_000 }, HOY, ESQUEMA);
    expect(deUnaVez).toBe(110_000);

    let pagado = 0;
    let recargoCobrado = 0;
    let entregado = 0;

    // Vueltas de sobra: lo que se afirma es el TOTAL entregado hasta saldar, no
    // en cuántos pagos se logró.
    for (let vuelta = 0; vuelta < 60; vuelta++) {
      const d = { id: "c", vencimiento: VENCIDA, importe: 100_000, pagado, recargoCobrado };
      const falta = totalAPagar(d, HOY, ESQUEMA);
      if (falta === 0) break;

      // Entrega un tercio de lo que falta, como quien paga de a poco.
      const entrega = Math.min(falta, Math.max(1, Math.ceil(falta / 3)));
      const r = imputarPago(entrega, [d], { hoy: HOY, esquema: ESQUEMA });
      for (const i of r.imputaciones) {
        pagado += i.aCapital;
        recargoCobrado += i.aRecargo;
      }
      entregado += entrega - r.aFavor;
    }

    expect(entregado, "pagar en varias veces salió más caro").toBe(deUnaVez);
  });

  it("si pagó parte ANTES de vencer, el recargo es sobre lo que quedó debiendo", () => {
    // Es lo justo: el recargo castiga lo que se pagó tarde, no lo que se pagó
    // a tiempo.
    const d = { id: "c", vencimiento: VENCIDA, importe: 100_000, pagado: 50_000, recargoCobrado: 0 };
    expect(calcularRecargo(d, HOY, ESQUEMA)).toBe(5_000);
    expect(totalAPagar(d, HOY, ESQUEMA)).toBe(55_000);
  });

  it("una deuda saldada no tiene recargo", () => {
    const d = { id: "c", vencimiento: VENCIDA, importe: 100_000, pagado: 100_000, recargoCobrado: 10_000 };
    expect(calcularRecargo(d, HOY, ESQUEMA)).toBe(0);
    expect(totalAPagar(d, HOY, ESQUEMA)).toBe(0);
  });
});
