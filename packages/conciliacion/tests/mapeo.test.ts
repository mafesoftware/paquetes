/**
 * Tests unitarios de `parsearConMapeo` que cierran la rama de "saldo
 * corrido inconsistente" — ningún fixture golden trae un extracto con el
 * saldo mal calculado entre líneas consecutivas.
 */
import { describe, expect, it } from "vitest";
import { parsearConMapeo, type MapeoColumnas } from "../src/mapeo.js";

const MAPEO: MapeoColumnas = {
  fecha: "Fecha",
  descripcion: "Descripcion",
  importe: "Importe",
  saldo: "Saldo",
  formatoFecha: "DD/MM/YYYY",
  separadorDecimal: ",",
};

describe("parsearConMapeo — saldo corrido", () => {
  it("saldo consistente (anterior + importe = saldo) no genera advertencia", () => {
    const filas = [
      ["Fecha", "Descripcion", "Importe", "Saldo"],
      ["01/09/2026", "Depósito", "100,00", "1.000,00"],
      ["02/09/2026", "Extracción", "-50,00", "950,00"],
    ];
    const { advertencias } = parsearConMapeo(filas, MAPEO);
    expect(advertencias).toEqual([]);
  });

  it("saldo corrido inconsistente genera advertencia con el número de línea del archivo", () => {
    const filas = [
      ["Fecha", "Descripcion", "Importe", "Saldo"],
      ["01/09/2026", "Depósito", "100,00", "1.000,00"],
      ["02/09/2026", "Extracción", "-50,00", "800,00"], // debería dar 950,00
    ];
    const { advertencias } = parsearConMapeo(filas, MAPEO);
    expect(advertencias).toHaveLength(1);
    expect(advertencias[0]).toMatchObject({ linea: 3 });
    expect(advertencias[0]?.mensaje).toContain("Saldo corrido inconsistente");
  });
});
