import { describe, expect, it } from "vitest";
import { diferenciaDeAjuste } from "../src/diferencia.js";
import { calcularAjuste } from "../src/ajuste.js";

describe("diferenciaDeAjuste", () => {
  it("es la diferencia entre el monto ajustado con el definitivo y con el usado", () => {
    const montoBase = 10_000_000n;
    const valorBase = "3448.3";
    const valorUsado = "3650.0";
    const valorDefinitivo = "3662.2";

    const diferencia = diferenciaDeAjuste(montoBase, valorBase, valorUsado, valorDefinitivo);

    const conUsado = calcularAjuste(montoBase, valorBase, valorUsado).montoAjustado;
    const conDefinitivo = calcularAjuste(montoBase, valorBase, valorDefinitivo).montoAjustado;
    expect(diferencia).toBe(conDefinitivo - conUsado);
    expect(diferencia).toBe(35_380n);
  });

  it("valorDefinitivo == valorUsado: diferencia 0", () => {
    expect(diferenciaDeAjuste(10_000_000n, "100", "150", "150")).toBe(0n);
  });

  it("el definitivo termina MENOR al usado: diferencia negativa (a favor del cliente)", () => {
    const diferencia = diferenciaDeAjuste(10_000_000n, "100", "160", "150");
    expect(diferencia).toBeLessThan(0n);
    expect(diferencia).toBe(-1_000_000n);
  });
});
