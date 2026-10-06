/**
 * `parserGaliciaPdf` — ramas del loop de secciones que el fixture golden
 * (`extracto.pdf`, 2 cuentas ARS/USD) no ejercita: texto antes de la primera
 * cuenta, líneas decorativas sin "|", y el caso sin ninguna cuenta
 * detectada. Se mockea `extraerLineasPdf` (en vez de generar un `.pdf`
 * real) para controlar el texto "extraído" sin depender de una librería de
 * escritura de PDF que este paquete no tiene como dependencia.
 */
import { vi, describe, it, expect } from "vitest";

const estado = vi.hoisted(() => ({ paginas: [] as string[][] }));

vi.mock("../src/pdf.js", () => ({
  extraerLineasPdf: async () => estado.paginas,
}));

const { parserGaliciaPdf } = await import("../src/bancos/galicia.js");

describe("parserGaliciaPdf — ramas del loop de secciones", () => {
  it("texto antes de la primera cuenta se ignora (título del extracto)", async () => {
    estado.paginas = [
      ["Extracto bancario", "Banco Galicia S.A.", "Cuenta 123 ARS", "Fecha|Descripcion|Debito|Credito|Saldo|Referencia", "01/09/2026|Depósito|0,00|100,00|100,00|"],
    ];
    const extractos = await parserGaliciaPdf.parsear(new Uint8Array());
    expect(extractos).toHaveLength(1);
    expect(extractos[0]?.lineas).toHaveLength(1);
  });

  it('línea decorativa sin "|" entre filas de datos se descarta', async () => {
    estado.paginas = [
      [
        "Cuenta 123 ARS",
        "Fecha|Descripcion|Debito|Credito|Saldo|Referencia",
        "-------- página 1 --------",
        "01/09/2026|Depósito|0,00|100,00|100,00|",
      ],
    ];
    const extractos = await parserGaliciaPdf.parsear(new Uint8Array());
    expect(extractos[0]?.lineas).toHaveLength(1);
  });

  it("sin ninguna cuenta detectada -> sin extractos", async () => {
    estado.paginas = [["Solo texto decorativo sin ninguna sección de cuenta"]];
    const extractos = await parserGaliciaPdf.parsear(new Uint8Array());
    expect(extractos).toEqual([]);
  });

  it("saldo corrido inconsistente dentro de una sección -> el extracto trae `advertencias`", async () => {
    estado.paginas = [
      [
        "Cuenta 123 ARS",
        "Fecha|Descripcion|Debito|Credito|Saldo|Referencia",
        "01/09/2026|Deposito|0,00|100,00|1000,00|",
        "02/09/2026|Extraccion|50,00|0,00|800,00|",
      ],
    ];
    const extractos = await parserGaliciaPdf.parsear(new Uint8Array());
    expect(extractos[0]?.advertencias).toHaveLength(1);
  });
});
