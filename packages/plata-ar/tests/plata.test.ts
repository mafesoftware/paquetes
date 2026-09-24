import { describe, it, expect } from "vitest";
import {
  aCentavos,
  aPesos,
  formatearPlata,
  plataARS,
  parsearPlata,
  parsearNumeroAR,
  parsearPorcentaje,
  parsearCantidad,
  pesosParaPlanilla,
  repartirCentavos,
  aplicarPorcentaje,
  sumarCentavos,
} from "../src/index.ts";

describe("aCentavos", () => {
  it("no pierde el centavo de la coma flotante", () => {
    // 19.99 * 100 da 1998.9999999999998; truncar dejaria 1998.
    expect(aCentavos(19.99)).toBe(1999);
  });
  it("devuelve null para lo que no es un monto", () => {
    // `null` y no `0`: un cero silencioso queda registrado como si fuera lo que
    // la persona quiso escribir, y en un pago eso es un recibo por cero pesos.
    expect(aCentavos(NaN)).toBeNull();
    expect(aCentavos(Infinity)).toBeNull();
  });
  it("es la vuelta de aPesos", () => {
    expect(aPesos(aCentavos(1234.56)!)).toBeCloseTo(1234.56, 10);
  });
});

describe("formatearPlata", () => {
  it("sin decimales cuando el monto es redondo", () => {
    expect(plataARS(4400000)).not.toMatch(/,00/);
  });
  it("con decimales cuando no lo es", () => {
    expect(plataARS(25914)).toMatch(/,14/);
  });
  it("fuerza decimales si se lo piden", () => {
    expect(formatearPlata(100000, { decimalesSiempre: true })).toMatch(/,00/);
  });
  it("acepta otra moneda para los clubes de LATAM", () => {
    const uy = formatearPlata(100000, { moneda: "UYU", locale: "es-UY" });
    expect(uy).toContain("1.000");
  });
});

describe("parsearPlata", () => {
  it("con coma, la coma es el decimal", () => {
    expect(parsearPlata("1.234,56")).toBe(123456);
    expect(parsearPlata("$ 1.234,56")).toBe(123456);
  });
  it("sin coma, un punto y tres digitos son miles", () => {
    expect(parsearPlata("44.000")).toBe(4400000);
    expect(parsearPlata("1.500")).toBe(150000);
  });
  it("sin coma, un punto y uno o dos digitos es decimal (planilla en ingles)", () => {
    expect(parsearPlata("1234.56")).toBe(123456);
    expect(parsearPlata("10.5")).toBe(1050);
  });
  it("varios grupos de miles", () => {
    expect(parsearPlata("1.234.000")).toBe(123400000);
  });
  it("null cuando no hay numero", () => {
    expect(parsearPlata("")).toBeNull();
    expect(parsearPlata("abc")).toBeNull();
    expect(parsearPlata("$")).toBeNull();
  });
  it("acepta negativos (una nota de credito, un ajuste a favor)", () => {
    expect(parsearPlata("-500")).toBe(-50000);
  });
});

describe("parsearNumeroAR y sus alias no multiplican por cien", () => {
  it("un porcentaje tipeado 10 es diez, no mil", () => {
    expect(parsearPorcentaje("10")).toBe(10);
  });
  it("una cantidad tipeada 25 es veinticinco", () => {
    expect(parsearCantidad("25")).toBe(25);
  });
  it("y sigue entendiendo el formato argentino", () => {
    expect(parsearNumeroAR("1.234,5")).toBe(1234.5);
  });
  it("null si después de limpiar no queda un número válido", () => {
    expect(parsearNumeroAR("12-34")).toBeNull();
  });
});

describe("pesosParaPlanilla", () => {
  it("numero sumable cuando es redondo", () => {
    expect(pesosParaPlanilla(4400000)).toBe(44000);
  });
  it("texto con coma decimal cuando hay centavos", () => {
    expect(pesosParaPlanilla(25914)).toBe("259,14");
  });
  it("nunca trae separador de miles, que rompe la suma de Excel", () => {
    expect(String(pesosParaPlanilla(4400000))).not.toContain(".");
  });
});

describe("repartirCentavos", () => {
  it("la suma de las partes da SIEMPRE el total", () => {
    for (const total of [100, 1000, 12345, 999999, 1]) {
      for (const pesos of [[1, 1, 1], [3, 1], [1, 1, 1, 1, 1, 1, 1], [7, 2, 91]]) {
        const partes = repartirCentavos(total, pesos);
        expect(sumarCentavos(partes)).toBe(total);
      }
    }
  });
  it("los centavos sueltos van a las partes mas grandes", () => {
    // 100 entre 3 partes iguales: 34 / 33 / 33.
    expect(repartirCentavos(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
  it("reparte proporcionalmente", () => {
    expect(repartirCentavos(1000, [3, 1])).toEqual([750, 250]);
  });
  it("sin proporciones validas reparte en partes iguales", () => {
    expect(repartirCentavos(10, [0, 0, 0])).toEqual([4, 3, 3]);
  });
  it("lista vacia devuelve lista vacia", () => {
    expect(repartirCentavos(100, [])).toEqual([]);
  });
  it("un grupo familiar de 5 con un descuento que no divide exacto", () => {
    const partes = repartirCentavos(10001, [1, 1, 1, 1, 1]);
    expect(sumarCentavos(partes)).toBe(10001);
    expect(partes).toHaveLength(5);
  });
});

describe("aplicarPorcentaje", () => {
  it("un recargo por mora del 10%", () => {
    expect(aplicarPorcentaje(1000000, 10)).toBe(100000);
  });
  it("redondea al centavo", () => {
    expect(aplicarPorcentaje(123400, 21)).toBe(25914);
  });
  it("0 para un porcentaje que no es numero", () => {
    expect(aplicarPorcentaje(1000, NaN)).toBe(0);
  });
});

describe("sumarCentavos", () => {
  it("suma vacia es cero", () => {
    expect(sumarCentavos([])).toBe(0);
  });
  it("suma", () => {
    expect(sumarCentavos([100, 250, 3])).toBe(353);
  });
});

describe("un monto fuera de rango no es un monto", () => {
  /**
   * `Number` acepta `"99999999999999999999"` y lo convierte a `1e+22`, que ya no
   * es un entero exacto: pasado `MAX_SAFE_INTEGER` los enteros de JavaScript
   * empiezan a saltar de dos en dos y después de mil en mil.
   *
   * Eso terminaba en una columna `bigint` de Postgres, que lo rechaza —o peor,
   * se guarda un número que nadie tipeó—. El límite es técnico, no de producto:
   * `MAX_SAFE_INTEGER` centavos son unos noventa billones de pesos, así que
   * ninguna cuota de ningún club se acerca.
   */
  it("un número absurdo se rechaza como cualquier otra cosa que no es plata", () => {
    for (const t of ["99999999999999999999", "1" + "0".repeat(30), "9007199254740993"]) {
      expect(parsearPlata(t), `aceptó ${t}`).toBeNull();
    }
  });

  it("lo que un club puede llegar a cobrar de verdad sigue entrando", () => {
    // Mil millones de pesos: absurdo para una cuota y muy lejos del límite.
    expect(parsearPlata("1.000.000.000")).toBe(100_000_000_000);
    expect(parsearPlata("44.000")).toBe(4_400_000);
    expect(parsearPlata("1.234,56")).toBe(123_456);
  });

  it("el negativo grande también", () => {
    expect(parsearPlata("-99999999999999999999")).toBeNull();
    // Un negativo normal sigue pasando: quien decide si vale es quien llama.
    expect(parsearPlata("-500")).toBe(-50_000);
  });

  it("aCentavos avisa en vez de devolver un número que miente", () => {
    expect(aCentavos(1e18)).toBeNull();
    expect(aCentavos(19.99)).toBe(1999);
    expect(aCentavos(Infinity)).toBeNull();
    expect(aCentavos(NaN)).toBeNull();
  });
});
