import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  filasDesdeMatriz,
  leerMatriz,
  mapearColumnas,
  previsualizar,
  separarPorClaveNatural,
  validarFilas,
  type Validador,
} from "../src/motor.js";

describe("leerMatriz", () => {
  async function bufferDe(armar: (hoja: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet("Hoja1");
    armar(hoja);
    return new Uint8Array(await libro.xlsx.writeBuffer());
  }

  it("lee encabezado (fila 1) y filas de datos como texto", async () => {
    const archivo = await bufferDe((hoja) => {
      hoja.addRow(["Código", "Nombre"]);
      hoja.addRow(["1", "Cemento"]);
      hoja.addRow(["2", "Arena"]);
    });

    const matriz = await leerMatriz(archivo);

    expect(matriz.encabezado).toEqual(["Código", "Nombre"]);
    expect(matriz.filas).toEqual([
      ["1", "Cemento"],
      ["2", "Arena"],
    ]);
  });

  it("una celda vacía es '' y nunca null", async () => {
    const archivo = await bufferDe((hoja) => {
      hoja.addRow(["a", "b"]);
      const fila = hoja.addRow(["x"]);
      fila.getCell(2).value = null;
    });

    const matriz = await leerMatriz(archivo);

    expect(matriz.filas[0]).toEqual(["x", ""]);
  });

  it("una celda NUMÉRICA se convierte a texto con coma decimal (no punto)", async () => {
    const archivo = await bufferDe((hoja) => {
      hoja.addRow(["cantidad"]);
      hoja.addRow([1234.56]);
      hoja.addRow([-5.2]);
      hoja.addRow([1000000]);
    });

    const matriz = await leerMatriz(archivo);

    expect(matriz.filas).toEqual([["1234,56"], ["-5,2"], ["1000000"]]);
  });

  it("un archivo sin ninguna hoja da encabezado y filas vacíos", async () => {
    const libro = new ExcelJS.Workbook();
    const archivo = new Uint8Array(await libro.xlsx.writeBuffer());

    const matriz = await leerMatriz(archivo);

    expect(matriz).toEqual({ encabezado: [], filas: [] });
  });

  it("una fila más corta que el encabezado completa con '' hasta la cantidad de columnas del encabezado", async () => {
    const archivo = await bufferDe((hoja) => {
      hoja.addRow(["a", "b", "c"]);
      hoja.addRow(["1"]);
    });

    const matriz = await leerMatriz(archivo);

    expect(matriz.filas[0]).toEqual(["1", "", ""]);
  });
});

describe("mapearColumnas", () => {
  const columnas = [
    { campo: "codigo", alias: ["código", "code"] },
    { campo: "nombre", alias: ["nombre", "descripción"] },
    { campo: "notas", alias: ["notas"], obligatoria: false },
  ];

  it("encuentra cada columna por alias, sin importar el orden del archivo", () => {
    const resultado = mapearColumnas(["Descripción", "Code"], columnas);

    expect(resultado.indices).toEqual({ nombre: 0, codigo: 1 });
    expect(resultado.faltantes).toEqual([]);
  });

  it("ignora mayúsculas/tildes al comparar encabezados", () => {
    const resultado = mapearColumnas(["CÓDIGO", "NOMBRE"], columnas);

    expect(resultado.indices).toEqual({ codigo: 0, nombre: 1 });
  });

  it("una columna obligatoria ausente queda en faltantes", () => {
    const resultado = mapearColumnas(["Code"], columnas);

    expect(resultado.faltantes).toEqual(["nombre"]);
  });

  it("una columna NO obligatoria ausente no aparece en faltantes ni en indices", () => {
    const resultado = mapearColumnas(["Code", "Nombre"], columnas);

    expect(resultado.faltantes).toEqual([]);
    expect(resultado.indices.notas).toBeUndefined();
  });

  it("mapeoManual gana sobre los alias automáticos", () => {
    const resultado = mapearColumnas(["Mi Columna Rara", "Nombre"], columnas, { codigo: "Mi Columna Rara" });

    expect(resultado.indices.codigo).toBe(0);
  });

  it("un mapeoManual que no matchea ningún encabezado real cae a los alias", () => {
    const resultado = mapearColumnas(["Código", "Nombre"], columnas, { codigo: "no existe en el archivo" });

    expect(resultado.indices.codigo).toBe(0);
  });
});

describe("filasDesdeMatriz", () => {
  it("arma FilaCruda usando los índices de mapearColumnas", () => {
    const filas = filasDesdeMatriz(
      [
        ["1", "Cemento", "extra"],
        ["2", "Arena", "extra2"],
      ],
      { codigo: 0, nombre: 1 },
    );

    expect(filas).toEqual([
      { codigo: "1", nombre: "Cemento" },
      { codigo: "2", nombre: "Arena" },
    ]);
  });

  it("un valor null/undefined en la matriz se vuelve ''", () => {
    const filas = filasDesdeMatriz([[null, undefined]], { a: 0, b: 1 });

    expect(filas).toEqual([{ a: "", b: "" }]);
  });

  it("recorta espacios de cada celda", () => {
    const filas = filasDesdeMatriz([["  hola  "]], { campo: 0 });

    expect(filas).toEqual([{ campo: "hola" }]);
  });
});

type Dato = { codigo: string; cantidad: number };

const validadorDeEjemplo: Validador<Dato> = (fila, _numeroFila) => {
  if (!fila.codigo) return { ok: false, error: "Falta el código" };
  const cantidad = Number(fila.cantidad);
  if (!Number.isFinite(cantidad)) return { ok: false, error: "Cantidad inválida" };
  return { ok: true, datos: { codigo: fila.codigo, cantidad } };
};

describe("validarFilas", () => {
  it("nunca aborta: una fila con error no impide validar el resto", () => {
    const resultado = validarFilas(
      [
        { codigo: "1", cantidad: "10" },
        { codigo: "", cantidad: "20" },
        { codigo: "3", cantidad: "no-es-numero" },
        { codigo: "4", cantidad: "40" },
      ],
      validadorDeEjemplo,
    );

    expect(resultado.validas).toEqual([
      { fila: 2, datos: { codigo: "1", cantidad: 10 } },
      { fila: 5, datos: { codigo: "4", cantidad: 40 } },
    ]);
    expect(resultado.errores).toEqual([
      { fila: 3, error: "Falta el código" },
      { fila: 4, error: "Cantidad inválida" },
    ]);
  });

  it("el número de fila es base 1 + 1 por el encabezado", () => {
    const resultado = validarFilas([{ codigo: "1", cantidad: "1" }], validadorDeEjemplo);

    expect(resultado.validas[0]?.fila).toBe(2);
  });

  it("sin filas, no hay válidas ni errores", () => {
    const resultado = validarFilas([], validadorDeEjemplo);

    expect(resultado).toEqual({ validas: [], errores: [] });
  });
});

describe("separarPorClaveNatural", () => {
  const claveDe = (d: Dato) => d.codigo;

  it("sin clavesExistentes, todas las filas son nuevas", () => {
    const validas = [
      { fila: 2, datos: { codigo: "a", cantidad: 1 } },
      { fila: 3, datos: { codigo: "b", cantidad: 2 } },
    ];

    const resultado = separarPorClaveNatural(validas, claveDe);

    expect(resultado.nuevas).toEqual(validas);
    expect(resultado.yaImportadas).toEqual([]);
  });

  it("una clave repetida DENTRO del archivo: gana la primera aparición", () => {
    const validas = [
      { fila: 2, datos: { codigo: "a", cantidad: 1 } },
      { fila: 3, datos: { codigo: "a", cantidad: 2 } },
    ];

    const resultado = separarPorClaveNatural(validas, claveDe);

    expect(resultado.nuevas).toEqual([validas[0]]);
    expect(resultado.yaImportadas).toEqual([{ ...validas[1], clave: "a" }]);
  });

  it("una clave que ya existía (fuera del archivo) se marca yaImportada, no es error", () => {
    const validas = [{ fila: 2, datos: { codigo: "a", cantidad: 1 } }];

    const resultado = separarPorClaveNatural(validas, claveDe, new Set(["a"]));

    expect(resultado.nuevas).toEqual([]);
    expect(resultado.yaImportadas).toEqual([{ ...validas[0], clave: "a" }]);
  });
});

describe("previsualizar", () => {
  it("compone validarFilas + separarPorClaveNatural en un solo resultado", () => {
    const resultado = previsualizar(
      [
        { codigo: "1", cantidad: "10" },
        { codigo: "1", cantidad: "20" }, // misma clave natural, duplicada en el archivo
        { codigo: "", cantidad: "30" }, // inválida
        { codigo: "2", cantidad: "40" }, // ya existe en la organización
      ],
      validadorDeEjemplo,
      (d) => d.codigo,
      new Set(["2"]),
    );

    expect(resultado.errores).toEqual([{ fila: 4, error: "Falta el código" }]);
    expect(resultado.nuevas).toEqual([{ fila: 2, datos: { codigo: "1", cantidad: 10 } }]);
    expect(resultado.yaImportadas.map((f) => f.clave)).toEqual(["1", "2"]);
  });
});
