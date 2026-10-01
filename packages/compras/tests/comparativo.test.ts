import { describe, expect, it } from "vitest";
import { armarComparativo } from "../src/comparativo.js";

/**
 * Escenario: cemento 200 bolsas — A $ 12.000 (5 días), B $ 11.800 (10 días),
 * C $ 12.300; hierro 5.000 kg — A $ 1.500, B $ 1.550, C $ 1.480. Precios en
 * CENTAVOS (plata siempre `bigint` + centavos) — $ 12.000 = 1_200_000n.
 */
const ITEMS = [
  { id: "cemento", cantidad: "200" },
  { id: "hierro", cantidad: "5000" },
];
const PROVEEDORES = ["A", "B", "C"];
const RESPUESTAS = [
  { proveedorId: "A", itemId: "cemento", precio: 1_200_000n, plazoDias: 5, condiciones: null },
  { proveedorId: "B", itemId: "cemento", precio: 1_180_000n, plazoDias: 10, condiciones: null },
  { proveedorId: "C", itemId: "cemento", precio: 1_230_000n, plazoDias: 7, condiciones: null },
  { proveedorId: "A", itemId: "hierro", precio: 150_000n, plazoDias: 5, condiciones: null },
  { proveedorId: "B", itemId: "hierro", precio: 155_000n, plazoDias: 10, condiciones: null },
  { proveedorId: "C", itemId: "hierro", precio: 148_000n, plazoDias: 7, condiciones: null },
];

describe("armarComparativo", () => {
  it("mejor por ítem: B gana cemento, C gana hierro", () => {
    const cuadro = armarComparativo(ITEMS, PROVEEDORES, RESPUESTAS);
    expect(cuadro.filas.find((f) => f.itemId === "cemento")?.mejor).toBe("B");
    expect(cuadro.filas.find((f) => f.itemId === "hierro")?.mejor).toBe("C");
  });

  it("subtotales y totales por proveedor: A $ 9.900.000, B $ 10.110.000, C $ 9.860.000", () => {
    const cuadro = armarComparativo(ITEMS, PROVEEDORES, RESPUESTAS);
    expect(cuadro.totales.A).toBe(990_000_000n);
    expect(cuadro.totales.B).toBe(1_011_000_000n);
    expect(cuadro.totales.C).toBe(986_000_000n);
  });

  it("mejor total: C (el total más bajo)", () => {
    const cuadro = armarComparativo(ITEMS, PROVEEDORES, RESPUESTAS);
    expect(cuadro.mejorTotal).toBe("C");
  });

  it("mejor combinado: B en cemento ($ 2.360.000) + C en hierro ($ 7.400.000) = $ 9.760.000", () => {
    const cuadro = armarComparativo(ITEMS, PROVEEDORES, RESPUESTAS);
    expect(cuadro.mejorCombinado).toBe(976_000_000n);
  });

  it("proveedor que no cotizó un ítem → celda vacía y no gana ese ítem", () => {
    const respuestas = RESPUESTAS.filter((r) => !(r.proveedorId === "A" && r.itemId === "hierro"));
    const cuadro = armarComparativo(ITEMS, PROVEEDORES, respuestas);
    const filaHierro = cuadro.filas.find((f) => f.itemId === "hierro");
    expect(filaHierro?.porProveedor.A).toBeNull();
    expect(filaHierro?.mejor).not.toBe("A");
  });

  it("empate de precio → gana el de menor plazo", () => {
    const items = [{ id: "arena", cantidad: "10" }];
    const respuestas = [
      { proveedorId: "A", itemId: "arena", precio: 100_000n, plazoDias: 8, condiciones: null },
      { proveedorId: "B", itemId: "arena", precio: 100_000n, plazoDias: 3, condiciones: null },
    ];
    const cuadro = armarComparativo(items, ["A", "B"], respuestas);
    expect(cuadro.filas[0]?.mejor).toBe("B");
  });

  it("ningún proveedor cotizó nada → mejorTotal null, mejorCombinado 0", () => {
    const cuadro = armarComparativo(ITEMS, PROVEEDORES, []);
    expect(cuadro.mejorTotal).toBeNull();
    expect(cuadro.mejorCombinado).toBe(0n);
    expect(cuadro.filas.every((f) => f.mejor === null)).toBe(true);
  });
});
