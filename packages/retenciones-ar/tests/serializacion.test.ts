import { describe, expect, it } from "vitest";
import { deserializarTablaGanancias, serializarTablaGanancias } from "../src/serializacion.js";
import type { TablaGanancias } from "../src/tipos.js";

const TABLA: TablaGanancias = {
  concepto: "honorarios",
  codigoSicore: "019",
  minimoNoSujeto: 122_882_00n,
  alicuotaInscripto: "escala",
  alicuotaNoInscripto: "28",
  escala: [
    { desde: 0n, hasta: 200_000_00n, fijo: 0n, porcentaje: "6" },
    { desde: 200_000_00n, hasta: null, fijo: 12_000_00n, porcentaje: "10" },
  ],
  retencionMinima: 240_00n,
};

describe("serializarTablaGanancias / deserializarTablaGanancias", () => {
  it("el resultado serializado es JSON.stringify-able (sin bigint) — el bug real que evita", () => {
    const serializada = serializarTablaGanancias(TABLA);
    expect(() => JSON.stringify(serializada)).not.toThrow();
  });

  it("ida y vuelta preserva los valores (incluido un tramo sin `hasta`)", () => {
    const idaYVuelta = deserializarTablaGanancias(serializarTablaGanancias(TABLA));
    expect(idaYVuelta).toEqual(TABLA);
  });
});
