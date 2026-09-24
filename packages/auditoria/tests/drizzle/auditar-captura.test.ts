import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { auditar, type EntradaAuditoria } from "../../src/drizzle/auditar.js";
import { tablaAuditoria } from "../../src/drizzle/tabla.js";
import type { DbCliente } from "../../src/drizzle/cliente.js";

/**
 * Ronda 5 — C1: entradas de un `Map` bajo una clave sensible se filtraban
 * en claro a `cambios`, porque `normalizarParaDiff` convertía el `Map` a un
 * arreglo de pares ANTES del diff (el arreglo entero es una hoja para
 * `loQueCambio`, y la ruta `"m"` no tiene ningún segmento sensible). Con el
 * ruling nuevo (un `Map` se vuelve un OBJETO plano), la clave del `Map`
 * pasa a ser un segmento de la ruta (`"m.password"`) y la redacción por
 * ruta la cubre.
 *
 * Estos tests corren el `auditar` REAL con un `dbOTx` FALSO que captura la
 * consulta (compilada con `PgDialect` a `{ sql, params }`), sin Postgres:
 * así se ve exactamente qué parámetros viajarían a la base.
 */
const tabla = tablaAuditoria({ nombre: "auditoria_captura_test" });

interface Capturado {
  params: unknown[];
  antes: unknown;
  despues: unknown;
  cambios: unknown;
}

function dbQueCaptura(capturas: Capturado[]): DbCliente {
  const dialecto = new PgDialect();
  const tx = {
    execute: async (consulta: SQL) => {
      const { params } = dialecto.sqlToQuery(consulta);
      // Orden de los parámetros en el INSERT de `auditar`: tenant, entidad,
      // entidadId, accion, actorTipo, actorId, antes, despues, cambios, ip,
      // userAgent.
      const parsear = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
      capturas.push({ params, antes: parsear(params[6]), despues: parsear(params[7]), cambios: parsear(params[8]) });
      return { rows: [{ id: "id-falso" }] };
    },
  };
  return { transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) } as unknown as DbCliente;
}

async function auditarCapturando(parcial: Pick<EntradaAuditoria, "antes" | "despues">): Promise<Capturado> {
  const capturas: Capturado[] = [];
  const resultado = await auditar(dbQueCaptura(capturas), tabla, {
    tenantId: "11111111-1111-1111-1111-111111111111",
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

describe("C1 (ronda 5) — un Map bajo/como clave sensible nunca filtra a cambios", () => {
  it('{ m: Map[["password","MAP1"]] } → MAP2: exactamente una entrada m.password "[redactado]"/"[redactado]"', async () => {
    const c = await auditarCapturando({
      antes: { m: new Map([["password", "MAP1"]]) },
      despues: { m: new Map([["password", "MAP2"]]) },
    });
    expect(c.cambios).toEqual([{ campo: "m.password", antes: "[redactado]", despues: "[redactado]" }]);
    const todo = JSON.stringify(c.params);
    expect(todo).not.toContain("MAP1");
    expect(todo).not.toContain("MAP2");
    // Las copias guardadas coinciden con cambios: misma forma (objeto), mismo campo tapado.
    expect(c.antes).toEqual({ m: { password: "[redactado]" } });
    expect(c.despues).toEqual({ m: { password: "[redactado]" } });
  });

  it("un Map en la RAÍZ que cambia: la clave sensible queda tapada en cambios y en las copias", async () => {
    const c = await auditarCapturando({
      antes: new Map([["token", "RAIZ1"], ["nombre", "Ana"]]),
      despues: new Map([["token", "RAIZ2"], ["nombre", "Ana"]]),
    });
    expect(c.cambios).toEqual([{ campo: "token", antes: "[redactado]", despues: "[redactado]" }]);
    expect(c.antes).toEqual({ token: "[redactado]", nombre: "Ana" });
    expect(c.despues).toEqual({ token: "[redactado]", nombre: "Ana" });
    const todo = JSON.stringify(c.params);
    expect(todo).not.toContain("RAIZ1");
    expect(todo).not.toContain("RAIZ2");
  });

  it('alta con Map[["token","X"]]: una entrada token con antes ausente y despues "[redactado]"', async () => {
    const c = await auditarCapturando({ despues: new Map([["token", "ALTA-X"]]) });
    expect(c.cambios).toEqual([{ campo: "token", despues: "[redactado]" }]);
    expect(c.antes).toBeNull();
    expect(c.despues).toEqual({ token: "[redactado]" });
    expect(JSON.stringify(c.params)).not.toContain("ALTA-X");
  });

  it('baja con Map[["token","X"]]: una entrada token con antes "[redactado]" y despues ausente', async () => {
    const c = await auditarCapturando({ antes: new Map([["token", "BAJA-X"]]) });
    expect(c.cambios).toEqual([{ campo: "token", antes: "[redactado]" }]);
    expect(c.antes).toEqual({ token: "[redactado]" });
    expect(c.despues).toBeNull();
    expect(JSON.stringify(c.params)).not.toContain("BAJA-X");
  });

  it('un toJSON que devuelve Map[["secret","Y"]]: limpio en cambios y en las copias', async () => {
    const conToJSON = (v: string) => ({ toJSON: () => new Map([["secret", v]]) });
    const c = await auditarCapturando({ antes: { d: conToJSON("TJ-Y1") }, despues: { d: conToJSON("TJ-Y2") } });
    expect(c.cambios).toEqual([{ campo: "d.secret", antes: "[redactado]", despues: "[redactado]" }]);
    expect(c.antes).toEqual({ d: { secret: "[redactado]" } });
    expect(c.despues).toEqual({ d: { secret: "[redactado]" } });
    const todo = JSON.stringify(c.params);
    expect(todo).not.toContain("TJ-Y1");
    expect(todo).not.toContain("TJ-Y2");
  });

  it('una clave de Map que COLISIONA con otra ("password" y un objeto cuyo toString da "password"): la segunda, "password (2)", también se tapa', async () => {
    const claveDisfrazada = { toString: () => "password" };
    const c = await auditarCapturando({
      antes: { m: new Map<unknown, string>([["password", "C1"], [claveDisfrazada, "C2"]]) },
      despues: { m: new Map<unknown, string>([["password", "C3"], [claveDisfrazada, "C4"]]) },
    });
    expect(c.cambios).toEqual([
      { campo: "m.password", antes: "[redactado]", despues: "[redactado]" },
      { campo: "m.password (2)", antes: "[redactado]", despues: "[redactado]" },
    ]);
    expect(c.antes).toEqual({ m: { password: "[redactado]", "password (2)": "[redactado]" } });
    const todo = JSON.stringify(c.params);
    for (const secreto of ["C1", "C2", "C3", "C4"]) expect(todo).not.toContain(`"${secreto}"`);
  });

  it("un Map sin clave sensible que no cambió no genera entradas; uno que cambió muestra el valor", async () => {
    const igual = await auditarCapturando({ antes: { m: new Map([["a", 1]]) }, despues: { m: new Map([["a", 1]]) } });
    expect(igual.cambios).toEqual([]);
    const distinto = await auditarCapturando({ antes: { m: new Map([["a", 1]]) }, despues: { m: new Map([["a", 2]]) } });
    expect(distinto.cambios).toEqual([{ campo: "m.a", antes: 1, despues: 2 }]);
  });
});

/**
 * Ronda 5 — M4: `errorSeguro` (el sanitizador del catch de `auditar`)
 * nunca tiene que tirar él mismo, aunque el error atrapado sea un objeto
 * raro: un `Proxy` cuyas trampas tiran, un getter de `cause` que tira, o un
 * `cause` donde `"code" in causa` tira. En todos los casos: `{ ok: false }`
 * con el mensaje genérico, nunca una excepción que escape de `auditar`.
 */
describe("M4 (ronda 5) — errorSeguro nunca tira", () => {
  function dbQueTira(error: unknown): DbCliente {
    return {
      transaction: async () => {
        throw error;
      },
    } as unknown as DbCliente;
  }
  const trampaQueTira = () => {
    throw new Error("trampa rota SECRETO-TRAMPA");
  };

  const casos: [string, () => unknown][] = [
    ["un Proxy cuyas trampas has/get/getPrototypeOf tiran", () => new Proxy({}, { has: trampaQueTira, get: trampaQueTira, getPrototypeOf: trampaQueTira })],
    ["un error cuyo getter de cause tira", () => Object.defineProperty(new Error("x"), "cause", { get: trampaQueTira })],
    ['un cause donde "code" in causa tira (Proxy con has roto)', () => Object.assign(new Error("x"), { cause: new Proxy({}, { has: trampaQueTira }) })],
    ["un cause cuyo getter de code tira", () => Object.assign(new Error("x"), { cause: Object.defineProperty({}, "code", { get: trampaQueTira, enumerable: true }) })],
    ["un Proxy revocado como error", () => { const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); return proxy; }],
  ];

  for (const [nombre, crear] of casos) {
    it(`${nombre}: { ok: false } con el mensaje genérico, sin tirar`, async () => {
      const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const resultado = await auditar(dbQueTira(crear()), tabla, {
          tenantId: "11111111-1111-1111-1111-111111111111",
          entidad: "test",
          entidadId: "1",
          accion: "crear",
          actor: { tipo: "sistema" },
        });
        expect(resultado).toEqual({ ok: false, error: { codigo: null, mensaje: "error de base de datos sin detalle" } });
        expect(spyError).toHaveBeenCalledTimes(1);
        expect(spyError.mock.calls.flat().join(" ")).not.toContain("SECRETO-TRAMPA");
      } finally {
        spyError.mockRestore();
      }
    });
  }

  it("un cause con code legible pero getter de message que tira: conserva el código, mensaje genérico", async () => {
    const causa = Object.defineProperty({ code: "23514" }, "message", { get: trampaQueTira, enumerable: true });
    const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const resultado = await auditar(dbQueTira(Object.assign(new Error("x"), { cause: causa })), tabla, {
        tenantId: "11111111-1111-1111-1111-111111111111",
        entidad: "test",
        entidadId: "1",
        accion: "crear",
        actor: { tipo: "sistema" },
      });
      expect(resultado).toEqual({ ok: false, error: { codigo: "23514", mensaje: "error de base de datos sin detalle" } });
    } finally {
      spyError.mockRestore();
    }
  });
});
