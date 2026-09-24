import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { auditar, type EntradaAuditoria } from "../../src/drizzle/auditar.js";
import { tablaAuditoria } from "../../src/drizzle/tabla.js";
import type { DbCliente } from "../../src/drizzle/cliente.js";

/**
 * Tarea P.10b — hotfix de redacción. Todo corre por el `auditar` REAL con un
 * `dbOTx` FALSO que compila la consulta con `PgDialect` y captura los
 * parámetros (sin Postgres), igual que `auditar-captura.test.ts`.
 *
 * N1: una clave de `Map` que colisiona (`"password (2)"`) filtraba su valor
 * a `cambios` cuando el `Map` quedaba adentro de una HOJA del diff (un
 * arreglo, un `Set`, un cambio de tipo, una raíz que pasa de `null` a un
 * arreglo): `redactarCambios` sacaba el sufijo de colisión al mirar la
 * ruta, pero la rama de objeto de `redactar` (que redacta el valor de la
 * hoja) no. Ahora las dos usan el mismo `esClaveSensible`.
 */
const tabla = tablaAuditoria({ nombre: "auditoria_claves_test" });
const TENANT = "11111111-1111-1111-1111-111111111111";

interface Capturado {
  params: unknown[];
  antes: unknown;
  despues: unknown;
  cambios: { campo: string; antes?: unknown; despues?: unknown }[];
}

function dbQueCaptura(capturas: Capturado[]): DbCliente {
  const dialecto = new PgDialect();
  const tx = {
    execute: async (consulta: SQL) => {
      const { params } = dialecto.sqlToQuery(consulta);
      const parsear = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
      capturas.push({ params, antes: parsear(params[6]), despues: parsear(params[7]), cambios: parsear(params[8]) as Capturado["cambios"] });
      return { rows: [{ id: "id-falso" }] };
    },
  };
  return { transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) } as unknown as DbCliente;
}

async function auditarCapturando(parcial: Partial<EntradaAuditoria>): Promise<Capturado> {
  const capturas: Capturado[] = [];
  const resultado = await auditar(dbQueCaptura(capturas), tabla, {
    tenantId: TENANT,
    entidad: "test",
    entidadId: "1",
    accion: "actualizar",
    actor: { tipo: "sistema" },
    ...parcial,
  });
  expect(resultado).toEqual({ ok: true, id: "id-falso" });
  expect(capturas).toHaveLength(1);
  return capturas[0]!;
}

/** El valor en `ruta` (con puntos; `"(raiz)"` es el valor entero) de una copia guardada. */
function enRuta(copia: unknown, campo: string): unknown {
  if (campo === "(raiz)") return copia;
  let actual = copia;
  for (const segmento of campo.split(".")) {
    if (actual === null || typeof actual !== "object") return undefined;
    actual = (actual as Record<string, unknown>)[segmento];
  }
  return actual;
}

/** Ningún secreto en NINGÚN parámetro, y cada lado definido de `cambios` coincide con la copia guardada en esa ruta. */
function verificar(c: Capturado, secretos: readonly string[]): void {
  const todo = JSON.stringify(c.params);
  for (const secreto of secretos) expect(todo).not.toContain(secreto);
  expect(c.cambios.length).toBeGreaterThan(0);
  for (const cambio of c.cambios) {
    if (cambio.antes !== undefined) expect(cambio.antes).toEqual(enRuta(c.antes, cambio.campo));
    if (cambio.despues !== undefined) expect(cambio.despues).toEqual(enRuta(c.despues, cambio.campo));
  }
}

/** Un `Map` con `"password"` y una clave-objeto cuyo `String()` también da `"password"` (queda `"password (2)"`). */
const claveDisfrazada = { toString: () => "password" };
function mapColision(a: string, b: string): Map<unknown, string> {
  return new Map<unknown, string>([
    ["password", a],
    [claveDisfrazada, b],
  ]);
}
const TAPADO = { password: "[redactado]", "password (2)": "[redactado]" };

describe('N1 (P.10b) — una clave de Map que colisiona ("password (2)") dentro de una hoja del diff nunca filtra', () => {
  it("adentro de un arreglo: { l: [Map[password→LA1, disfrazada→LB1]] } → LB2", async () => {
    const c = await auditarCapturando({ antes: { l: [mapColision("LA1", "LB1")] }, despues: { l: [mapColision("LA1", "LB2")] } });
    expect(c.cambios).toEqual([{ campo: "l", antes: [TAPADO], despues: [TAPADO] }]);
    expect(c.antes).toEqual({ l: [TAPADO] });
    expect(c.despues).toEqual({ l: [TAPADO] });
    verificar(c, ["LA1", "LB1", "LB2"]);
  });

  it('en un cambio de tipo: { m: "texto" } → { m: Map[password, disfrazada→TB2] }', async () => {
    const c = await auditarCapturando({ antes: { m: "texto" }, despues: { m: mapColision("TA2", "TB2") } });
    expect(c.cambios).toEqual([{ campo: "m", antes: "texto", despues: TAPADO }]);
    expect(c.despues).toEqual({ m: TAPADO });
    verificar(c, ["TA2", "TB2"]);
  });

  it("adentro de un Set", async () => {
    const c = await auditarCapturando({ antes: { s: new Set([mapColision("SA1", "SB1")]) }, despues: { s: new Set([mapColision("SA1", "SB2")]) } });
    expect(c.cambios).toEqual([{ campo: "s", antes: [TAPADO], despues: [TAPADO] }]);
    expect(c.antes).toEqual({ s: [TAPADO] });
    verificar(c, ["SA1", "SB1", "SB2"]);
  });

  it("una raíz que pasa de null a un arreglo con ese Map", async () => {
    const c = await auditarCapturando({ antes: null, despues: [mapColision("RA2", "RB2")] });
    expect(c.cambios).toEqual([{ campo: "(raiz)", antes: null, despues: [TAPADO] }]);
    expect(c.despues).toEqual([TAPADO]);
    verificar(c, ["RA2", "RB2"]);
  });

  it('una colisión triple ("password (3)") y una sobre una clave literal "password (2)" ("password (2) (2)") también se tapan', async () => {
    const otra = { toString: () => "password" };
    const triple = (s: string) => new Map<unknown, string>([["password", `${s}1`], [claveDisfrazada, `${s}2`], [otra, `${s}3`]]);
    const literal = (s: string) => new Map<unknown, string>([["password (2)", `${s}1`], [{ toString: () => "password (2)" }, `${s}2`]]);
    const c = await auditarCapturando({ antes: { l: [triple("TRA"), literal("LIA")] }, despues: { l: [triple("TRB"), literal("LIB")] } });
    expect(c.despues).toEqual({
      l: [
        { password: "[redactado]", "password (2)": "[redactado]", "password (3)": "[redactado]" },
        { "password (2)": "[redactado]", "password (2) (2)": "[redactado]" },
      ],
    });
    verificar(c, ["TRA", "TRB", "LIA", "LIB"]);
  });
});

describe("N3 (P.10b) — una clave LITERAL \"password (2)\" en un objeto plano es sensible en todos lados", () => {
  it("las copias guardadas y cambios coinciden: las dos la tapan", async () => {
    const c = await auditarCapturando({ antes: { o: { "password (2)": "LIT1", nombre: "Ana" } }, despues: { o: { "password (2)": "LIT2", nombre: "Ana" } } });
    expect(c.cambios).toEqual([{ campo: "o.password (2)", antes: "[redactado]", despues: "[redactado]" }]);
    expect(c.antes).toEqual({ o: { "password (2)": "[redactado]", nombre: "Ana" } });
    expect(c.despues).toEqual({ o: { "password (2)": "[redactado]", nombre: "Ana" } });
    verificar(c, ["LIT1", "LIT2"]);
  });

  it("también adentro de una hoja (arreglo)", async () => {
    const c = await auditarCapturando({ antes: { l: [{ "token (7)": "LT1" }] }, despues: { l: [{ "token (7)": "LT2" }] } });
    expect(c.cambios).toEqual([{ campo: "l", antes: [{ "token (7)": "[redactado]" }], despues: [{ "token (7)": "[redactado]" }] }]);
    verificar(c, ["LT1", "LT2"]);
  });
});

describe("Claves con acentos, mayúsculas y separadores (P.10b)", () => {
  it('"contraseña", "Contraseña", "CONTRASEÑA" y "clave_secreta" se tapan en las copias y en cambios', async () => {
    const c = await auditarCapturando({
      antes: { contraseña: "AC1", Contraseña: "AC2", CONTRASEÑA: "AC3", clave_secreta: "AC4", nombre: "Ana" },
      despues: { contraseña: "BC1", Contraseña: "BC2", CONTRASEÑA: "BC3", clave_secreta: "BC4", nombre: "Ana" },
    });
    const tapado = { contraseña: "[redactado]", Contraseña: "[redactado]", CONTRASEÑA: "[redactado]", clave_secreta: "[redactado]", nombre: "Ana" };
    expect(c.antes).toEqual(tapado);
    expect(c.despues).toEqual(tapado);
    expect(c.cambios).toHaveLength(4);
    for (const cambio of c.cambios) expect(cambio).toMatchObject({ antes: "[redactado]", despues: "[redactado]" });
    verificar(c, ["AC1", "AC2", "AC3", "AC4", "BC1", "BC2", "BC3", "BC4"]);
  });

  it("una contraseña acentuada anidada, como clave de Map y adentro de un arreglo", async () => {
    const c = await auditarCapturando({
      antes: { u: { "nueva Contraseña": "NA1" }, m: new Map([["contraseña", "NA2"]]), l: [{ CONTRASEÑA: "NA3" }] },
      despues: { u: { "nueva Contraseña": "NB1" }, m: new Map([["contraseña", "NB2"]]), l: [{ CONTRASEÑA: "NB3" }] },
    });
    expect(c.despues).toEqual({ u: { "nueva Contraseña": "[redactado]" }, m: { contraseña: "[redactado]" }, l: [{ CONTRASEÑA: "[redactado]" }] });
    verificar(c, ["NA1", "NA2", "NA3", "NB1", "NB2", "NB3"]);
  });

  it("un término PROPIO con acento matchea la clave con o sin acento", async () => {
    const c = await auditarCapturando({
      camposSensibles: ["código"],
      antes: { codigo: "K1", Código: "K2", mi_CODIGO: "K3", nombre: "Ana" },
      despues: { codigo: "K4", Código: "K5", mi_CODIGO: "K6", nombre: "Beto" },
    });
    expect(c.despues).toEqual({ codigo: "[redactado]", Código: "[redactado]", mi_CODIGO: "[redactado]", nombre: "Beto" });
    expect(c.cambios).toContainEqual({ campo: "nombre", antes: "Ana", despues: "Beto" });
    verificar(c, ["K1", "K2", "K3", "K4", "K5", "K6"]);
  });

  it("espacios como separador: \"api key\" y \"Access Token\" se tapan", async () => {
    const c = await auditarCapturando({ antes: { "api key": "SP1", "Access Token": "SP2" }, despues: { "api key": "SP3", "Access Token": "SP4" } });
    expect(c.despues).toEqual({ "api key": "[redactado]", "Access Token": "[redactado]" });
    verificar(c, ["SP1", "SP2", "SP3", "SP4"]);
  });
});

describe("N2 (P.10b) — getters rotos en entidad/entidadId/accion nunca hacen rechazar a auditar", () => {
  const trampa = (): never => {
    throw new Error("getter roto SECRETO-GETTER");
  };

  for (const campo of ["entidad", "entidadId", "accion"] as const) {
    it(`un getter de ${campo} que tira: resuelve { ok: false } (preparación), sin tocar la base ni loguear el error`, async () => {
      const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
      const transaction = vi.fn(async () => {
        throw new Error("no debería llamarse");
      });
      try {
        const entrada = { tenantId: TENANT, entidad: "test", entidadId: "1", accion: "crear", actor: { tipo: "sistema" } } as Record<string, unknown>;
        Object.defineProperty(entrada, campo, { get: trampa, enumerable: true });
        const resultado = await auditar({ transaction } as unknown as DbCliente, tabla, entrada as unknown as EntradaAuditoria);
        expect(resultado).toEqual({ ok: false, error: { codigo: null, mensaje: "error preparando la auditoría" } });
        expect(transaction).not.toHaveBeenCalled();
        expect(spyError).toHaveBeenCalledTimes(1);
        const log = spyError.mock.calls.flat().join(" ");
        expect(log).toContain(`${campo}=[desconocido]`);
        expect(log).not.toContain("SECRETO-GETTER");
      } finally {
        spyError.mockRestore();
      }
    });
  }

  it("un getter que funciona UNA vez y después tira: se lee una sola vez, el insert usa ese valor", async () => {
    let lecturas = 0;
    const entrada = { tenantId: TENANT, entidadId: "1", accion: "crear", actor: { tipo: "sistema" } } as Record<string, unknown>;
    Object.defineProperty(entrada, "entidad", {
      enumerable: true,
      get: () => {
        lecturas++;
        if (lecturas > 1) trampa();
        return "producto";
      },
    });
    const capturas: Capturado[] = [];
    const resultado = await auditar(dbQueCaptura(capturas), tabla, entrada as unknown as EntradaAuditoria);
    expect(resultado).toEqual({ ok: true, id: "id-falso" });
    expect(lecturas).toBe(1);
    expect(capturas[0]!.params[1]).toBe("producto");
  });

  it("un getter que tira desde la SEGUNDA lectura, con la base fallando: el log usa el valor capturado y auditar resuelve", async () => {
    const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const entrada = { tenantId: TENANT, entidad: "test", actor: { tipo: "sistema" } } as Record<string, unknown>;
      for (const [campo, valor] of [["entidadId", "42"], ["accion", "borrar"]] as const) {
        let lecturas = 0;
        Object.defineProperty(entrada, campo, {
          enumerable: true,
          get: () => {
            lecturas++;
            if (lecturas > 1) trampa();
            return valor;
          },
        });
      }
      // La transacción SÍ corre el callback (así el INSERT arma la consulta y lee los campos), y el execute falla.
      const txQueFalla = { execute: async () => { throw new Error("se cayó la base"); } };
      const dbQueFalla = { transaction: async (cb: (t: typeof txQueFalla) => unknown) => cb(txQueFalla) } as unknown as DbCliente;
      const resultado = await auditar(dbQueFalla, tabla, entrada as unknown as EntradaAuditoria);
      expect(resultado).toEqual({ ok: false, error: { codigo: null, mensaje: "error de base de datos sin detalle" } });
      const log = spyError.mock.calls.flat().join(" ");
      expect(log).toContain("entidadId=42");
      expect(log).toContain("accion=borrar");
      expect(log).not.toContain("SECRETO-GETTER");
    } finally {
      spyError.mockRestore();
    }
  });
});
