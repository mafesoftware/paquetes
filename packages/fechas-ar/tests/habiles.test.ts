import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { anteriorHabil, esHabil, siguienteHabil } from "../src/habiles.ts";
import { ErrorFecha } from "../src/errores.ts";
import { diaDeSemana, sumarDiasISO } from "../src/index.ts";

const SIN_FERIADOS: ReadonlySet<string> = new Set();

describe("esHabil", () => {
  it("un martes sin feriados es habil", () => {
    expect(esHabil("2026-09-01", SIN_FERIADOS)).toBe(true); // martes
  });
  it("sabado y domingo no son habiles", () => {
    expect(esHabil("2026-09-05", SIN_FERIADOS)).toBe(false); // sabado
    expect(esHabil("2026-09-06", SIN_FERIADOS)).toBe(false); // domingo
  });
  it("un dia de semana feriado no es habil", () => {
    const feriados = new Set(["2026-09-04"]); // viernes
    expect(esHabil("2026-09-04", feriados)).toBe(false);
  });
  it("estar en el set de feriados no afecta a otro dia", () => {
    const feriados = new Set(["2026-09-04"]);
    expect(esHabil("2026-09-01", feriados)).toBe(true);
  });
  it("tira ErrorFecha con una fecha invalida", () => {
    expect(() => esHabil("2026-02-30", SIN_FERIADOS)).toThrow(ErrorFecha);
  });
});

describe("siguienteHabil", () => {
  it("si ya es habil, devuelve la misma fecha (documentado)", () => {
    expect(siguienteHabil("2026-09-01", SIN_FERIADOS)).toBe("2026-09-01"); // martes
  });
  it("sobre un sabado, salta al lunes", () => {
    expect(siguienteHabil("2026-09-05", SIN_FERIADOS)).toBe("2026-09-07");
  });
  it("sobre un domingo, salta al lunes", () => {
    expect(siguienteHabil("2026-09-06", SIN_FERIADOS)).toBe("2026-09-07");
  });
  it("viernes feriado + fin de semana: salta al lunes (test del brief)", () => {
    const feriados = new Set(["2026-09-04"]); // viernes feriado
    expect(siguienteHabil("2026-09-04", feriados)).toBe("2026-09-07");
  });
  it("si el lunes tambien es feriado, sigue hasta el martes", () => {
    const feriados = new Set(["2026-09-04", "2026-09-07"]); // viernes y lunes feriados
    expect(siguienteHabil("2026-09-04", feriados)).toBe("2026-09-08");
  });
  it("tira ErrorFecha con una fecha invalida", () => {
    expect(() => siguienteHabil("2026-13-01", SIN_FERIADOS)).toThrow(ErrorFecha);
  });
});

describe("anteriorHabil (espejo de siguienteHabil, agregado por trivial)", () => {
  it("si ya es habil, devuelve la misma fecha", () => {
    expect(anteriorHabil("2026-09-01", SIN_FERIADOS)).toBe("2026-09-01");
  });
  it("sobre un domingo, retrocede al viernes", () => {
    expect(anteriorHabil("2026-09-06", SIN_FERIADOS)).toBe("2026-09-04");
  });
  it("sobre un lunes feriado + fin de semana, retrocede al viernes anterior", () => {
    const feriados = new Set(["2026-09-07"]); // lunes feriado
    expect(anteriorHabil("2026-09-07", feriados)).toBe("2026-09-04");
  });
  it("tira ErrorFecha con una fecha invalida", () => {
    expect(() => anteriorHabil("no-es-fecha", SIN_FERIADOS)).toThrow(ErrorFecha);
  });
});

describe("propiedad: siguienteHabil siempre da un habil >= la fecha pedida", () => {
  it("para fechas y feriados al azar", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 27 }), // dia de la fecha de partida: siempre valido en cualquier mes
        fc.integer({ min: 1, max: 12 }),
        fc.array(fc.integer({ min: 1, max: 27 }), { minLength: 0, maxLength: 10 }),
        (dia, mes, diasFeriados) => {
          const anio = 2026;
          const fecha = `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
          const feriados = new Set(diasFeriados.map((d) => `${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`));

          const resultado = siguienteHabil(fecha, feriados);

          expect(esHabil(resultado, feriados)).toBe(true);
          // resultado >= fecha, comparando como strings ISO (orden lexicografico = orden cronologico).
          expect(resultado >= fecha).toBe(true);
        },
      ),
    );
  });
});

// Referencia cruzada: diaDeSemana y sumarDiasISO (0.1) son la base de los
// fixtures de arriba, para no tener que confiar en un calendario memorizado.
describe("fixtures de este archivo, verificados contra 0.1", () => {
  it("2026-09-04 es viernes y 2026-09-07 es el lunes siguiente", () => {
    expect(diaDeSemana("2026-09-04")).toBe(5);
    expect(sumarDiasISO("2026-09-04", 3)).toBe("2026-09-07");
    expect(diaDeSemana("2026-09-07")).toBe(1);
  });
});
