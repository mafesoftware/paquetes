/**
 * Los 5 bancos CSV con banner `<BANCO>;CUENTA;<numero>;<moneda>` comparten la
 * misma forma de parsear moneda/cuenta (`esMoneda` con 3 ramas `||`, más los
 * `??` de `banner[2]`/`banner[3]`) — ningún fixture golden usa otra moneda
 * que ARS ni un banner incompleto, así que esas ramas quedan sin cubrir.
 */
import { describe, expect, it } from "vitest";
import { parserGaliciaCsv } from "../src/bancos/galicia.js";
import { parserMacroCsv } from "../src/bancos/macro.js";
import { parserNacionCsv } from "../src/bancos/nacion.js";
import { parserProvinciaCsv } from "../src/bancos/provincia.js";
import { parserSantanderCsv } from "../src/bancos/santander.js";
import type { ParserExtracto } from "../src/motor.js";

function archivo(texto: string): Uint8Array {
  return new TextEncoder().encode(texto);
}

type Caso = {
  nombre: string;
  parser: ParserExtracto;
  nombreBanco: string;
  encabezado: string;
  /** 2 filas de datos con saldo corrido inconsistente (1000 -> debería dar 950, el archivo dice 800). */
  datosConSaldoInconsistente: string;
};

const CASOS: Caso[] = [
  {
    nombre: "galicia",
    parser: parserGaliciaCsv,
    nombreBanco: "GALICIA",
    encabezado: "Fecha;Descripcion;Debito;Credito;Saldo;Referencia",
    datosConSaldoInconsistente: "01/09/2026;Deposito;0,00;100,00;1000,00;\n02/09/2026;Extraccion;50,00;0,00;800,00;",
  },
  {
    nombre: "macro",
    parser: parserMacroCsv,
    nombreBanco: "MACRO",
    encabezado: "Referencia;Saldo;Credito;Debito;Descripcion;Fecha",
    datosConSaldoInconsistente: ";1000,00;100,00;0,00;Deposito;01/09/2026\n;800,00;0,00;50,00;Extraccion;02/09/2026",
  },
  {
    nombre: "nacion",
    parser: parserNacionCsv,
    nombreBanco: "NACION",
    encabezado: "Fecha;Descripcion;Importe;Saldo;Referencia",
    datosConSaldoInconsistente: "2026-09-01;Deposito;100.00;1000.00;\n2026-09-02;Extraccion;-50.00;800.00;",
  },
  {
    nombre: "provincia",
    parser: parserProvinciaCsv,
    nombreBanco: "PROVINCIA",
    encabezado: "Fecha;Descripcion;Debito;Credito;Saldo;Referencia",
    datosConSaldoInconsistente: "01-09-2026;Deposito;0,00;100,00;1000,00;\n02-09-2026;Extraccion;50,00;0,00;800,00;",
  },
  {
    nombre: "santander",
    parser: parserSantanderCsv,
    nombreBanco: "SANTANDER",
    encabezado: "Fecha;Concepto;Importe;Saldo;Referencia",
    datosConSaldoInconsistente: "01/09/2026;Deposito;100,00;1000,00;\n02/09/2026;Extraccion;-50,00;800,00;",
  },
];

describe.each(CASOS)("$nombre — moneda y banner", ({ parser, nombreBanco, encabezado, datosConSaldoInconsistente }) => {
  it("moneda USD en el banner", async () => {
    const [extracto] = await parser.parsear(archivo(`${nombreBanco};CUENTA;123;USD\n${encabezado}`));
    expect(extracto?.moneda).toBe("USD");
  });

  it("moneda EUR en el banner", async () => {
    const [extracto] = await parser.parsear(archivo(`${nombreBanco};CUENTA;123;EUR\n${encabezado}`));
    expect(extracto?.moneda).toBe("EUR");
  });

  it("moneda no reconocida en el banner -> cae a ARS por defecto", async () => {
    const [extracto] = await parser.parsear(archivo(`${nombreBanco};CUENTA;123;XXX\n${encabezado}`));
    expect(extracto?.moneda).toBe("ARS");
  });

  it("banner incompleto (sin número de cuenta ni moneda) -> cuenta vacía, moneda ARS por defecto", async () => {
    const [extracto] = await parser.parsear(archivo(`${nombreBanco}\n${encabezado}`));
    expect(extracto?.cuenta).toBe("");
    expect(extracto?.moneda).toBe("ARS");
  });

  it("archivo completamente vacío (sin ninguna fila, ni banner) -> cuenta vacía, moneda ARS, sin líneas", async () => {
    const [extracto] = await parser.parsear(archivo(""));
    expect(extracto).toMatchObject({ cuenta: "", moneda: "ARS", lineas: [] });
  });

  it("saldo corrido inconsistente -> el extracto trae `advertencias`", async () => {
    const [extracto] = await parser.parsear(archivo(`${nombreBanco};CUENTA;123;ARS\n${encabezado}\n${datosConSaldoInconsistente}`));
    expect(extracto?.advertencias).toHaveLength(1);
  });
});
