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

describe("serializarTablaGanancias / deserializarTablaGanancias — sin escala (alícuota fija)", () => {
  const TABLA_SIN_ESCALA: TablaGanancias = {
    concepto: "bienes",
    codigoSicore: "078",
    minimoNoSujeto: 224_000_00n,
    alicuotaInscripto: "2",
    alicuotaNoInscripto: "10",
    retencionMinima: 240_00n,
  };

  it("serializa sin agregar la clave `escala`", () => {
    const serializada = serializarTablaGanancias(TABLA_SIN_ESCALA);
    expect(serializada).not.toHaveProperty("escala");
    expect(() => JSON.stringify(serializada)).not.toThrow();
  });

  it("ida y vuelta preserva los valores (sin escala)", () => {
    const idaYVuelta = deserializarTablaGanancias(serializarTablaGanancias(TABLA_SIN_ESCALA));
    expect(idaYVuelta).toEqual(TABLA_SIN_ESCALA);
    expect(idaYVuelta).not.toHaveProperty("escala");
  });
});
