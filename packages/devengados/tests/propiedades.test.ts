import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cuotasVencidas,
  devengadoAl,
  estadoSaldo,
  matrizPorPeriodo,
  montoVigente,
  periodosEntre,
  type ContratoMensual,
} from "../src/index.js";

const pad = (n: number) => String(n).padStart(2, "0");

const periodo = fc
  .record({ anio: fc.integer({ min: 2000, max: 2040 }), mes: fc.integer({ min: 1, max: 12 }) })
  .map(({ anio, mes }) => `${anio}-${pad(mes)}`);

/** Días 1..28 para que toda fecha generada exista. */
const fecha = fc
  .record({ p: periodo, dia: fc.integer({ min: 1, max: 28 }) })
  .map(({ p, dia }) => `${p}-${pad(dia)}`);

const centavos = fc.bigInt({ min: 0n, max: 10_000_000_00n });

const contrato: fc.Arbitrary<ContratoMensual> = fc.record({
  inicio: fecha,
  baja: fc.option(fecha, { nil: null }),
  diaVencimiento: fc.integer({ min: -5, max: 40 }),
  vigencias: fc.array(fc.record({ desde: periodo, monto: centavos }), { maxLength: 5 }),
  corte: fc.option(fecha, { nil: null }),
  devengadoPrevio: fc.option(centavos, { nil: undefined }),
});

describe("propiedades de los devengados", () => {
  it("devengadoAl es monótono en `hasta` (con montos no negativos)", () => {
    fc.assert(
      fc.property(contrato, fecha, fecha, (c, a, b) => {
        const [antes, despues] = a <= b ? [a, b] : [b, a];
        expect(devengadoAl(c, antes) <= devengadoAl(c, despues)).toBe(true);
      }),
    );
  });

  it("la suma de cuotasVencidas es devengadoAl − devengadoPrevio", () => {
    fc.assert(
      fc.property(contrato, fecha, (c, hasta) => {
        const suma = cuotasVencidas(c, hasta).reduce((acc, q) => acc + q.monto, 0n);
        expect(suma).toBe(devengadoAl(c, hasta) - (c.devengadoPrevio ?? 0n));
      }),
    );
  });

  it("cada cuota vencida es de un mes distinto, en orden, ya vencida, dentro del contrato y con el monto vigente", () => {
    fc.assert(
      fc.property(contrato, fecha, (c, hasta) => {
        const cuotas = cuotasVencidas(c, hasta);
        for (let i = 0; i < cuotas.length; i++) {
          const q = cuotas[i]!;
          if (i > 0) expect(q.periodo > cuotas[i - 1]!.periodo).toBe(true);
          expect(q.vence <= hasta).toBe(true);
          expect(q.vence.slice(0, 7)).toBe(q.periodo);
          expect(q.periodo >= c.inicio.slice(0, 7)).toBe(true);
          if (c.baja) expect(q.periodo <= c.baja.slice(0, 7)).toBe(true);
          if (c.corte) expect(q.periodo > c.corte.slice(0, 7)).toBe(true);
          expect(q.monto).toBe(montoVigente(c.vigencias, q.periodo));
        }
      }),
    );
  });

  it("matrizPorPeriodo: total == suma de porFila == suma de porPeriodo == suma de celdas", () => {
    const fila = fc.record({
      fila: fc.constantFrom("luz", "gas", "sueldos", "alquiler"),
      periodo,
      importe: fc.bigInt({ min: -1_000_000_00n, max: 1_000_000_00n }),
    });
    fc.assert(
      fc.property(fc.array(fila, { maxLength: 40 }), (filas) => {
        const m = matrizPorPeriodo(filas);
        const sumar = (xs: Iterable<bigint>) => [...xs].reduce((a, b) => a + b, 0n);
        const esperado = sumar(filas.map((f) => f.importe));
        expect(m.total).toBe(esperado);
        expect(sumar(m.porFila.values())).toBe(m.total);
        expect(sumar(m.porPeriodo.values())).toBe(m.total);
        expect(sumar([...m.celdas.values()].flatMap((f) => [...f.values()]))).toBe(m.total);
        for (const [nombre, celdas] of m.celdas) expect(sumar(celdas.values())).toBe(m.porFila.get(nombre));
      }),
    );
  });

  it("estadoSaldo es total y consistente con la comparación devengado/pagado", () => {
    const monto = fc.bigInt({ min: -1_000_000_00n, max: 1_000_000_00n });
    fc.assert(
      fc.property(monto, monto, (devengado, pagado) => {
        const estado = estadoSaldo(devengado, pagado);
        expect(["sin_deuda", "pendiente", "parcial", "saldada", "pagado_de_mas"]).toContain(estado);
        if (estado === "sin_deuda") expect(devengado <= 0n && pagado <= 0n).toBe(true);
        if (estado === "pendiente") expect(devengado > 0n && pagado <= 0n).toBe(true);
        if (estado === "parcial") expect(pagado > 0n && pagado < devengado).toBe(true);
        if (estado === "saldada") expect(pagado > 0n && pagado === devengado).toBe(true);
        if (estado === "pagado_de_mas") expect(pagado > 0n && pagado > devengado).toBe(true);
      }),
    );
  });

  it("periodosEntre: largo = diferencia de meses + 1, consecutivos y con ambos extremos", () => {
    const meses = (p: string) => Number(p.slice(0, 4)) * 12 + Number(p.slice(5, 7));
    fc.assert(
      fc.property(periodo, periodo, (a, b) => {
        const lista = periodosEntre(a, b);
        expect(lista.length).toBe(Math.max(0, meses(b) - meses(a) + 1));
        if (lista.length > 0) {
          expect(lista[0]).toBe(a);
          expect(lista.at(-1)).toBe(b);
        }
        for (let i = 1; i < lista.length; i++) expect(meses(lista[i]!) - meses(lista[i - 1]!)).toBe(1);
      }),
    );
  });

  it("montoVigente no depende del orden de vigencias con `desde` distintos", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.record({ desde: periodo, monto: centavos }), { selector: (v) => v.desde, maxLength: 6 }),
        periodo,
        (vigencias, p) => {
          expect(montoVigente([...vigencias].reverse(), p)).toBe(montoVigente(vigencias, p));
        },
      ),
    );
  });
});
