import { describe, expect, it } from "vitest";
import { elegirAlicuotaVigente, parsearLineaAgip, parsearLineaArba } from "../src/padron.js";
import type { FilaPadronConOrigen } from "../src/tipos.js";

const FIXTURE_ARBA_10_LINEAS = [
  "R|01102026|01102026|31122026|30712345671|C|A|N|1,75|01",
  "P|01102026|01102026|31122026|30712345672|C|A|N|2,50|01",
  "R|01102026|01102026||30712345673|C|A|N|3,00|02",
  "R|01102026|01072026|30092026|30712345674|C|A|N|1,00|01",
  "P|01102026|01102026|31122026|30712345675|D|A|N|4,75|03",
  "R|01102026|01102026|31122026|30712345676|C|A|N|1,25|01",
  "P|01102026|01102026|31122026|30712345677|C|A|N|2,25|02",
  "R|01102026|01102026|31122026|30712345678|C|A|N|1,75|01",
  "P|01102026|01102026|31122026|30712345679|C|A|N|3,50|01",
  "R|01102026|01102026|31122026|30712345670|C|A|N|0,50|01",
];

describe("parsearLineaArba", () => {
  it("parsea las 10 líneas de la fixture (brief Tarea 4.17)", () => {
    const resultados = FIXTURE_ARBA_10_LINEAS.map((linea) => parsearLineaArba(linea));
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(resultados).toHaveLength(10);
  });

  it("alicuotaPadron(ARBA, cuit, 2026-10-15, retencion) = 1.75 (brief)", () => {
    const parseo = parsearLineaArba(FIXTURE_ARBA_10_LINEAS[0]!);
    expect(parseo.ok).toBe(true);
    if (!parseo.ok) return;
    expect(parseo.fila).toMatchObject({ cuit: "30712345671", tipo: "retencion", alicuota: "1.75", vigenteDesde: "2026-10-01", vigenteHasta: "2026-12-31" });
  });

  it("fuera de vigencia → elegirAlicuotaVigente devuelve null", () => {
    const parseo = parsearLineaArba(FIXTURE_ARBA_10_LINEAS[0]!);
    if (!parseo.ok) throw new Error("fixture inválida");
    const filas: FilaPadronConOrigen[] = [{ ...parseo.fila, origen: "global" }];
    expect(elegirAlicuotaVigente(filas, "2027-01-02")).toBeNull();
    expect(elegirAlicuotaVigente(filas, "2026-10-15")).toBe("1.75");
  });

  it("línea malformada (campos de menos) → error, no tira", () => {
    const resultado = parsearLineaArba("R|01102026|01102026|31122026|30712345671");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/10 campos/);
  });

  it("marca de baja (B) → error, no se importa", () => {
    const resultado = parsearLineaArba("R|01102026|01102026|31122026|30712345671|C|B|N|1,75|01");
    expect(resultado.ok).toBe(false);
  });

  it("régimen inválido (ni R ni P) → error", () => {
    const resultado = parsearLineaArba("X|01102026|01102026|31122026|30712345671|C|A|N|1,75|01");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/Régimen inválido/);
  });

  it("CUIT inválido (no 11 dígitos) → error", () => {
    const resultado = parsearLineaArba("R|01102026|01102026|31122026|123|C|A|N|1,75|01");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/CUIT inválido/);
  });

  it("fecha de vigencia desde inválida → error", () => {
    const resultado = parsearLineaArba("R|01102026|99999999|31122026|30712345671|C|A|N|1,75|01");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/vigencia desde inválida/);
  });

  it("fecha de vigencia hasta inválida (no vacía) → error", () => {
    const resultado = parsearLineaArba("R|01102026|01102026|99999999|30712345671|C|A|N|1,75|01");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/vigencia hasta inválida/);
  });

  it("alícuota inválida → error", () => {
    const resultado = parsearLineaArba("R|01102026|01102026|31122026|30712345671|C|A|N|abc|01");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/Alícuota inválida/);
  });
});

describe("parsearLineaAgip", () => {
  it("percepción 2,00 y retención 1,50 → cada tipo su alícuota (brief)", () => {
    const resultado = parsearLineaAgip("01102026|01102026|31122026|30712345671|C|A|N|2,00|1,50|01|EMPRESA SA");
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.filas).toEqual([
      { cuit: "30712345671", tipo: "percepcion", alicuota: "2.00", vigenteDesde: "2026-10-01", vigenteHasta: "2026-12-31", grupo: "01", razonSocialContribuyente: "EMPRESA SA" },
      { cuit: "30712345671", tipo: "retencion", alicuota: "1.50", vigenteDesde: "2026-10-01", vigenteHasta: "2026-12-31", grupo: "01", razonSocialContribuyente: "EMPRESA SA" },
    ]);
  });

  it("solo percepción cargada (retención vacía) → una sola fila", () => {
    const resultado = parsearLineaAgip("01102026|01102026|31122026|30712345671|C|A|N|2,00||01|EMPRESA SA");
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.filas).toHaveLength(1);
    expect(resultado.filas[0]).toMatchObject({ tipo: "percepcion", alicuota: "2.00" });
  });

  it("solo retención cargada (percepción vacía) → una sola fila", () => {
    const resultado = parsearLineaAgip("01102026|01102026|31122026|30712345671|C|A|N||1,50|01|EMPRESA SA");
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.filas).toHaveLength(1);
    expect(resultado.filas[0]).toMatchObject({ tipo: "retencion", alicuota: "1.50" });
  });

  it("vigencia hasta vacía → vigenteHasta null", () => {
    const resultado = parsearLineaAgip("01102026|01102026||30712345671|C|A|N|2,00|1,50|01|EMPRESA SA");
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.filas[0]!.vigenteHasta).toBeNull();
  });

  it("líneas con campos de menos (no 11) → error", () => {
    const resultado = parsearLineaAgip("01102026|01102026|31122026|30712345671|C|A|N|2,00|1,50|01");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/11 campos/);
  });

  it("marca de baja (B) → error, no se importa", () => {
    const resultado = parsearLineaAgip("01102026|01102026|31122026|30712345671|C|B|N|2,00|1,50|01|EMPRESA SA");
    expect(resultado.ok).toBe(false);
  });

  it("CUIT inválido → error", () => {
    const resultado = parsearLineaAgip("01102026|01102026|31122026|123|C|A|N|2,00|1,50|01|EMPRESA SA");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/CUIT inválido/);
  });

  it("fecha de vigencia desde inválida → error", () => {
    const resultado = parsearLineaAgip("01102026|99999999|31122026|30712345671|C|A|N|2,00|1,50|01|EMPRESA SA");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/vigencia desde inválida/);
  });

  it("fecha de vigencia hasta inválida (no vacía) → error", () => {
    const resultado = parsearLineaAgip("01102026|01102026|99999999|30712345671|C|A|N|2,00|1,50|01|EMPRESA SA");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/vigencia hasta inválida/);
  });

  it("alícuota de percepción inválida → error", () => {
    const resultado = parsearLineaAgip("01102026|01102026|31122026|30712345671|C|A|N|abc|1,50|01|EMPRESA SA");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/Alícuota de percepción inválida/);
  });

  it("alícuota de retención inválida → error", () => {
    const resultado = parsearLineaAgip("01102026|01102026|31122026|30712345671|C|A|N|2,00|abc|01|EMPRESA SA");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/Alícuota de retención inválida/);
  });

  it("sin alícuota de percepción ni de retención → error", () => {
    const resultado = parsearLineaAgip("01102026|01102026|31122026|30712345671|C|A|N|||01|EMPRESA SA");
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.error).toMatch(/Sin alícuota/);
  });
});

describe("elegirAlicuotaVigente", () => {
  it("override de la organización gana sobre el global (brief)", () => {
    const filas: FilaPadronConOrigen[] = [
      { cuit: "1", tipo: "retencion", alicuota: "1.75", vigenteDesde: "2026-10-01", vigenteHasta: null, grupo: null, razonSocialContribuyente: null, origen: "global" },
      { cuit: "1", tipo: "retencion", alicuota: "9.99", vigenteDesde: "2026-10-01", vigenteHasta: null, grupo: null, razonSocialContribuyente: null, origen: "organizacion" },
    ];
    expect(elegirAlicuotaVigente(filas, "2026-10-15")).toBe("9.99");
  });

  it("varias globales vigentes (reimportaciones) → gana la de vigencia más reciente", () => {
    const filas: FilaPadronConOrigen[] = [
      { cuit: "1", tipo: "retencion", alicuota: "1.00", vigenteDesde: "2026-01-01", vigenteHasta: null, grupo: null, razonSocialContribuyente: null, origen: "global" },
      { cuit: "1", tipo: "retencion", alicuota: "2.00", vigenteDesde: "2026-06-01", vigenteHasta: null, grupo: null, razonSocialContribuyente: null, origen: "global" },
    ];
    expect(elegirAlicuotaVigente(filas, "2026-10-15")).toBe("2.00");
  });

  it("sin filas vigentes a la fecha → null", () => {
    const filas: FilaPadronConOrigen[] = [
      { cuit: "1", tipo: "retencion", alicuota: "1.00", vigenteDesde: "2026-01-01", vigenteHasta: "2026-03-31", grupo: null, razonSocialContribuyente: null, origen: "global" },
    ];
    expect(elegirAlicuotaVigente(filas, "2026-10-15")).toBeNull();
  });
});
