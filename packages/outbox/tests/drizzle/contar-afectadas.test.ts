import { describe, expect, it } from "vitest";
import { contarAfectadas } from "../../src/drizzle/contar-afectadas.js";

/**
 * `contarAfectadas` es lo que usan `registrarResultado`/`liberarFila`
 * (`procesar.ts`) y `purgarOutbox` (`purgar.ts`) para saber cuántas filas
 * tocó un `UPDATE`/`DELETE` — soporta las dos formas que puede tener el
 * resultado de `db.execute(...)` según el driver de Postgres (ver su
 * JSDoc): node-postgres siempre trae `rowCount`; algún otro driver
 * (ej. ciertas versiones/modos de neon-serverless) puede no traerlo, pero
 * siempre trae `rows` (gracias a que las consultas de este paquete siempre
 * llevan `RETURNING`) — sin este fallback, esos drivers harían que
 * `procesarOutbox` reportara CUALQUIER escritura real como "perdidos" en
 * silencio (el fencing pensaría que nunca escribió nada).
 */
describe("contarAfectadas", () => {
  it("usa rowCount cuando es un número (node-postgres)", () => {
    expect(contarAfectadas({ rowCount: 3, rows: [] })).toBe(3);
    expect(contarAfectadas({ rowCount: 0, rows: [{ id: "a" }] })).toBe(0); // rowCount manda, aunque rows tenga algo raro
  });

  it("cae a rows.length cuando rowCount falta o no es un número (stub de otro driver, ej. neon-serverless)", () => {
    expect(contarAfectadas({ rows: [{ id: "a" }, { id: "b" }] })).toBe(2);
    expect(contarAfectadas({ rowCount: null, rows: [{ id: "a" }] })).toBe(1);
    expect(contarAfectadas({ rowCount: undefined, rows: [] })).toBe(0);
  });

  it("da 0 (nunca tira) si ni rowCount ni rows tienen una forma reconocible", () => {
    expect(contarAfectadas({})).toBe(0);
    expect(contarAfectadas(null)).toBe(0);
    expect(contarAfectadas(undefined)).toBe(0);
    expect(contarAfectadas({ rows: "no-es-un-arreglo" })).toBe(0);
  });
});
