import { describe, expect, it } from "vitest";
import { ordenarPorClaveDeReclamo } from "../../src/drizzle/procesar.js";

/**
 * `reclamarLote` (`src/drizzle/procesar.ts`) reclama filas con un `UPDATE
 * ... FROM candidatos ... RETURNING ...`, donde `candidatos` es una CTE con
 * `ORDER BY coalesce(proximo_intento_en, programado_para) asc` — pero un
 * `UPDATE ... RETURNING` NO garantiza conservar ese orden: el plan puede
 * unir `candidatos` con la tabla en cualquier orden (ver el JSDoc de
 * `procesarOutbox`, "Dos fases"). Por eso `reclamarLote` ordena el
 * resultado EN JS, con `ordenarPorClaveDeReclamo`, antes de devolverlo — acá
 * se prueba esa función sola (sin Postgres): reproducirlo contra un
 * Postgres real es poco confiable (el planner casi siempre elige un plan
 * que YA da el orden correcto para lotes chicos, así que un test de
 * integración con filas "desordenadas" no fallaría antes del fix en la
 * mayoría de los entornos).
 */
describe("ordenarPorClaveDeReclamo", () => {
  it("ordena por claveOrdenMs ascendente, sin importar el orden de entrada", () => {
    const filas = [
      { id: "c", claveOrdenMs: 300 },
      { id: "a", claveOrdenMs: 100 },
      { id: "b", claveOrdenMs: 200 },
    ];
    expect(ordenarPorClaveDeReclamo(filas).map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("con la MISMA claveOrdenMs, desempata por id ascendente (orden estable y determinístico)", () => {
    const filas = [
      { id: "z", claveOrdenMs: 100 },
      { id: "a", claveOrdenMs: 100 },
      { id: "m", claveOrdenMs: 100 },
    ];
    expect(ordenarPorClaveDeReclamo(filas).map((f) => f.id)).toEqual(["a", "m", "z"]);
  });

  it("no muta el array de entrada", () => {
    const filas = [
      { id: "b", claveOrdenMs: 2 },
      { id: "a", claveOrdenMs: 1 },
    ];
    const original = [...filas];
    ordenarPorClaveDeReclamo(filas);
    expect(filas).toEqual(original);
  });

  it("un array vacío da un array vacío", () => {
    expect(ordenarPorClaveDeReclamo([])).toEqual([]);
  });
});
