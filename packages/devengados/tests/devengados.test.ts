import { describe, expect, it } from "vitest";
import {
  cuotasVencidas,
  devengadoAl,
  estadoSaldo,
  matrizPorPeriodo,
  montoVigente,
  periodoDeFecha,
  periodosEntre,
  primerDia,
  type ContratoMensual,
  type Vigencia,
} from "../src/index.js";

describe("estadoSaldo", () => {
  it.each([
    [0n, 0n, "sin_deuda"],
    [-5n, 0n, "sin_deuda"],
    [1000n, 0n, "pendiente"],
    [1000n, -10n, "pendiente"],
    [1000n, 400n, "parcial"],
    [1000n, 1000n, "saldada"],
    [1000n, 1200n, "pagado_de_mas"],
    [0n, 500n, "pagado_de_mas"],
  ] as const)("devengado %s, pagado %s → %s", (devengado, pagado, esperado) => {
    expect(estadoSaldo(devengado, pagado)).toBe(esperado);
  });

  it("rechaza montos que no son bigint", () => {
    expect(() => estadoSaldo(1000 as unknown as bigint, 0n)).toThrow(/bigint/);
    expect(() => estadoSaldo(0n, "5" as unknown as bigint)).toThrow(/bigint/);
  });
});

describe("períodos", () => {
  it("periodoDeFecha toma el mes de una fecha y rechaza fechas que no existen", () => {
    expect(periodoDeFecha("2026-06-15")).toBe("2026-06");
    expect(() => periodoDeFecha("2026-02-30")).toThrow(/periodoDeFecha: fecha inválida "2026-02-30"/);
    expect(() => periodoDeFecha("15/06/2026")).toThrow(/YYYY-MM-DD/);
  });

  it("periodosEntre cruza el año e incluye ambos extremos", () => {
    expect(periodosEntre("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(periodosEntre("2026-04", "2026-04")).toEqual(["2026-04"]);
    expect(periodosEntre("2026-05", "2026-04")).toEqual([]);
  });

  it("periodosEntre rechaza extremos inválidos (antes, un `hasta` basura podía no terminar nunca)", () => {
    expect(() => periodosEntre("2026-01", "basura")).toThrow(/periodosEntre \(hasta\): período inválido "basura"/);
    expect(() => periodosEntre("2026-13", "2026-01")).toThrow(/periodosEntre \(desde\)/);
  });

  it("primerDia arma la fecha del período y rechaza basura", () => {
    expect(primerDia("2026-06")).toBe("2026-06-01");
    expect(() => primerDia("2026-13")).toThrow(/primerDia: período inválido "2026-13"/);
    expect(() => primerDia("2026-6")).toThrow();
  });
});

describe("montoVigente", () => {
  const vigencias: Vigencia[] = [
    { desde: "2026-02", monto: 100n },
    { desde: "2026-06", monto: 150n },
  ];
  it("toma la vigencia más reciente que ya rige, sin importar el orden de la lista", () => {
    expect(montoVigente([...vigencias].reverse(), "2026-05")).toBe(100n);
    expect(montoVigente(vigencias, "2026-06")).toBe(150n);
    expect(montoVigente(vigencias, "2027-01")).toBe(150n);
  });
  it("antes de la primera vigencia no hay monto (no se inventa un 0)", () => {
    expect(montoVigente(vigencias, "2026-01")).toBeNull();
    expect(montoVigente([], "2026-01")).toBeNull();
  });
  it("con dos vigencias del mismo mes gana la primera de la lista", () => {
    expect(
      montoVigente(
        [
          { desde: "2026-02", monto: 1n },
          { desde: "2026-02", monto: 2n },
        ],
        "2026-03",
      ),
    ).toBe(1n);
  });
  it("valida el período y cada vigencia con un mensaje que dice cuál falla", () => {
    expect(() => montoVigente(vigencias, "2026-00")).toThrow(/montoVigente: período inválido/);
    expect(() => montoVigente([{ desde: "2026-06-01", monto: 1n }], "2026-07")).toThrow(/vigencias\[0\]\.desde/);
    expect(() => montoVigente([{ desde: "2026-06", monto: 1 as unknown as bigint }], "2026-07")).toThrow(
      /vigencias\[0\]\.monto/,
    );
    expect(() => montoVigente([undefined as unknown as Vigencia], "2026-07")).toThrow(/vigencias\[0\]/);
    expect(() => montoVigente(null as unknown as Vigencia[], "2026-07")).toThrow(/array/);
  });
});

describe("cuotasVencidas / devengadoAl", () => {
  const base: ContratoMensual = {
    inicio: "2026-02-01",
    baja: null,
    diaVencimiento: 10,
    vigencias: [{ desde: "2026-02", monto: 1_000_00n }],
  };

  it("cuenta un mes recién cuando pasó su día de vencimiento", () => {
    expect(cuotasVencidas(base, "2026-04-09").map((c) => c.periodo)).toEqual(["2026-02", "2026-03"]);
    expect(cuotasVencidas(base, "2026-04-10").map((c) => c.periodo)).toEqual(["2026-02", "2026-03", "2026-04"]);
  });

  it("devuelve período, monto y vencimiento de cada cuota", () => {
    expect(cuotasVencidas(base, "2026-02-10")).toEqual([{ periodo: "2026-02", monto: 1_000_00n, vence: "2026-02-10" }]);
  });

  it("antes del inicio no hay cuotas y el devengado es 0", () => {
    expect(cuotasVencidas(base, "2026-01-31")).toEqual([]);
    expect(devengadoAl(base, "2026-01-31")).toBe(0n);
  });

  it("con baja, no devenga después del mes de la baja", () => {
    expect(cuotasVencidas({ ...base, baja: "2026-03-15" }, "2026-12-31").map((c) => c.periodo)).toEqual([
      "2026-02",
      "2026-03",
    ]);
  });

  it("una baja posterior a `hasta` no adelanta nada", () => {
    expect(cuotasVencidas({ ...base, baja: "2027-01-01" }, "2026-03-31").map((c) => c.periodo)).toEqual([
      "2026-02",
      "2026-03",
    ]);
  });

  it("usa el monto actualizado desde el mes en que rige", () => {
    const conAumento = { ...base, vigencias: [...base.vigencias, { desde: "2026-04", monto: 1_500_00n }] };
    expect(devengadoAl(conAumento, "2026-05-31")).toBe(1_000_00n * 2n + 1_500_00n * 2n);
  });

  it("un mes sin vigencia que lo cubra no devenga (ni se inventa un 0)", () => {
    const tarde = { ...base, vigencias: [{ desde: "2026-04", monto: 500n }] };
    expect(cuotasVencidas(tarde, "2026-05-31").map((c) => c.periodo)).toEqual(["2026-04", "2026-05"]);
  });

  it("con corte de migración suma lo previo y solo cuenta los meses posteriores al corte", () => {
    const migrado = { ...base, corte: "2026-07-31", devengadoPrevio: 6_000_00n };
    expect(cuotasVencidas(migrado, "2026-09-30").map((c) => c.periodo)).toEqual(["2026-08", "2026-09"]);
    expect(devengadoAl(migrado, "2026-09-30")).toBe(6_000_00n + 2_000_00n);
  });

  it("un corte anterior al inicio no cambia desde cuándo devenga", () => {
    const corteViejo = { ...base, corte: "2025-12-31", devengadoPrevio: 0n };
    expect(cuotasVencidas(corteViejo, "2026-03-31").map((c) => c.periodo)).toEqual(["2026-02", "2026-03"]);
  });

  it("devengadoPrevio sin corte se suma igual", () => {
    expect(devengadoAl({ ...base, devengadoPrevio: 7n }, "2026-02-10")).toBe(1_000_00n + 7n);
  });

  it("un día de vencimiento fuera de rango se acota a 1..28 (febrero existe)", () => {
    expect(cuotasVencidas({ ...base, diaVencimiento: 31 }, "2026-02-28").map((c) => c.vence)).toEqual(["2026-02-28"]);
    expect(cuotasVencidas({ ...base, diaVencimiento: 0 }, "2026-02-01").map((c) => c.vence)).toEqual(["2026-02-01"]);
    expect(cuotasVencidas({ ...base, diaVencimiento: 5.9 }, "2026-02-05").map((c) => c.vence)).toEqual(["2026-02-05"]);
  });

  it("valida las entradas con mensajes que dicen qué campo falla", () => {
    expect(() => cuotasVencidas({ ...base, diaVencimiento: Number.NaN }, "2026-03-01")).toThrow(/diaVencimiento/);
    expect(() => cuotasVencidas({ ...base, diaVencimiento: "10" as unknown as number }, "2026-03-01")).toThrow(
      /diaVencimiento/,
    );
    expect(() => cuotasVencidas(base, "2026-3-1")).toThrow(/cuotasVencidas \(hasta\): fecha inválida/);
    expect(() => cuotasVencidas({ ...base, inicio: "2026-02" }, "2026-03-01")).toThrow(/\(inicio\)/);
    expect(() => cuotasVencidas({ ...base, baja: "2026-02-31" }, "2026-03-01")).toThrow(/\(baja\)/);
    expect(() => cuotasVencidas({ ...base, corte: "ayer" }, "2026-03-01")).toThrow(/\(corte\)/);
    expect(() => cuotasVencidas({ ...base, devengadoPrevio: 5 as unknown as bigint }, "2026-03-01")).toThrow(
      /devengadoPrevio/,
    );
    expect(() => cuotasVencidas({ ...base, vigencias: [{ desde: "x", monto: 1n }] }, "2026-03-01")).toThrow(
      /cuotasVencidas \(vigencias\[0\]\.desde\)/,
    );
  });
});

describe("matrizPorPeriodo", () => {
  it("acumula por celda, fila, período y total", () => {
    const m = matrizPorPeriodo([
      { fila: "luz", periodo: "2026-01", importe: 100n },
      { fila: "luz", periodo: "2026-01", importe: 50n },
      { fila: "gas", periodo: "2026-02", importe: 30n },
    ]);
    expect(m.celdas.get("luz")?.get("2026-01")).toBe(150n);
    expect(m.celdas.get("gas")?.get("2026-01")).toBeUndefined();
    expect(m.porFila.get("gas")).toBe(30n);
    expect(m.porPeriodo.get("2026-01")).toBe(150n);
    expect(m.total).toBe(180n);
  });

  it("vacía da una matriz vacía con total 0", () => {
    const m = matrizPorPeriodo([]);
    expect(m.celdas.size).toBe(0);
    expect(m.total).toBe(0n);
  });

  it("acepta cualquier iterable", () => {
    function* filas() {
      yield { fila: "a", periodo: "2026-01", importe: 1n };
      yield { fila: "a", periodo: "2026-02", importe: 2n };
    }
    expect(matrizPorPeriodo(filas()).porFila.get("a")).toBe(3n);
  });

  it("rechaza importes que no son bigint", () => {
    expect(() => matrizPorPeriodo([{ fila: "luz", periodo: "2026-01", importe: 1 as unknown as bigint }])).toThrow(
      /matrizPorPeriodo: el importe de \(luz, 2026-01\)/,
    );
  });
});
