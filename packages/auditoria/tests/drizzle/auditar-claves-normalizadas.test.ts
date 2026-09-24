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

/** El valor en `ruta` (con puntos; `"(raiz)"` es el valor entero) de una copia guardada. Una clave puede tener un punto adentro (`"api.key"`): se prueba cada prefijo de segmentos como clave. */
function enRuta(copia: unknown, campo: string): unknown {
  if (campo === "(raiz)") return copia;
  const resolver = (actual: unknown, segmentos: string[]): unknown => {
    if (segmentos.length === 0) return actual;
    if (actual === null || typeof actual !== "object") return undefined;
    // Cada clave propia que coincide con el principio de la ruta (la más larga primero).
    const candidatas = Object.keys(actual)
      .map((clave) => clave.split("."))
      .filter((partes) => partes.length <= segmentos.length && partes.every((p, i) => p === segmentos[i]))
      .sort((x, y) => y.length - x.length);
    for (const partes of candidatas) {
      const r = resolver((actual as Record<string, unknown>)[partes.join(".")], segmentos.slice(partes.length));
      if (r !== undefined) return r;
    }
    return undefined;
  };
  return resolver(copia, campo.split("."));
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

describe("Fix round 1 (P.10b) — I1: términos y claves con punto en cambios", () => {
  it('un término propio "api.key" con una clave "api.key": cambios queda [redactado]/[redactado], igual que las copias', async () => {
    const c = await auditarCapturando({ camposSensibles: ["api.key"], antes: { "api.key": "DOT1", x: 1 }, despues: { "api.key": "DOT2", x: 1 } });
    expect(c.cambios).toEqual([{ campo: "api.key", antes: "[redactado]", despues: "[redactado]" }]);
    expect(c.antes).toEqual({ "api.key": "[redactado]", x: 1 });
    expect(c.despues).toEqual({ "api.key": "[redactado]", x: 1 });
    verificar(c, ["DOT1", "DOT2"]);
  });

  it('un término con punto también matchea una clave anidada adentro de una hoja y como sufijo de una ruta más larga', async () => {
    const c = await auditarCapturando({
      camposSensibles: ["api.key"],
      antes: { l: [{ "api.key": "DOT3" }], cfg: { "mi.api.key": "DOT4" } },
      despues: { l: [{ "api.key": "DOT5" }], cfg: { "mi.api.key": "DOT6" } },
    });
    expect(c.despues).toEqual({ l: [{ "api.key": "[redactado]" }], cfg: { "mi.api.key": "[redactado]" } });
    verificar(c, ["DOT3", "DOT4", "DOT5", "DOT6"]);
  });

  it('el término default "apikey" con una clave "api.key": el punto NO es separador, así que NINGUNO de los dos lados la tapa (y coinciden)', async () => {
    const c = await auditarCapturando({ antes: { "api.key": "VIS1" }, despues: { "api.key": "VIS2" } });
    expect(c.antes).toEqual({ "api.key": "VIS1" });
    expect(c.despues).toEqual({ "api.key": "VIS2" });
    expect(c.cambios).toEqual([{ campo: "api.key", antes: "VIS1", despues: "VIS2" }]);
  });

  it('stripe: { secret } con el término "stripe.secret" sumado a los default: se tapa por "secret" (un término es un NOMBRE de clave)', async () => {
    const c = await auditarCapturando({
      camposSensibles: ["password", "secret", "stripe.secret"],
      antes: { stripe: { secret: "ST1" } },
      despues: { stripe: { secret: "ST2" } },
    });
    expect(c.cambios).toEqual([{ campo: "stripe.secret", antes: "[redactado]", despues: "[redactado]" }]);
    expect(c.despues).toEqual({ stripe: { secret: "[redactado]" } });
    verificar(c, ["ST1", "ST2"]);
  });

  it('un término con forma de ruta sobre una hoja NO default ("cuenta.numero"): desde la ronda de fix 2 tapa en las copias Y en cambios', async () => {
    const c = await auditarCapturando({ camposSensibles: ["cuenta.numero"], antes: { cuenta: { numero: "NUM1" } }, despues: { cuenta: { numero: "NUM2" } } });
    // Ronda de fix 1 documentaba una asimetría (las copias no lo tapaban). El
    // ruling de la ronda de fix 2 la cierra: `redactar` también prueba las
    // colas de la ruta de claves con un término con punto.
    expect(c.antes).toEqual({ cuenta: { numero: "[redactado]" } });
    expect(c.despues).toEqual({ cuenta: { numero: "[redactado]" } });
    expect(c.cambios).toEqual([{ campo: "cuenta.numero", antes: "[redactado]", despues: "[redactado]" }]);
    verificar(c, ["NUM1", "NUM2"]);
  });
});

describe("Fix round 1 (P.10b) — M1/M2/M6 por auditar", () => {
  it('M1: "ＰＡＳＳＷＯＲＤ" (ancho completo) y "pass\\u200Bword"/"pass\\u00ADword" (invisibles) se tapan', async () => {
    const c = await auditarCapturando({
      antes: { "ＰＡＳＳＷＯＲＤ": "FW1", "pass​word": "ZW1", "pass­word": "SH1" },
      despues: { "ＰＡＳＳＷＯＲＤ": "FW2", "pass​word": "ZW2", "pass­word": "SH2" },
    });
    expect(c.despues).toEqual({ "ＰＡＳＳＷＯＲＤ": "[redactado]", "pass​word": "[redactado]", "pass­word": "[redactado]" });
    verificar(c, ["FW1", "FW2", "ZW1", "ZW2", "SH1", "SH2"]);
  });

  it('M2: camposSensibles [""] (y "_", "-", " (2)") no tapa todo', async () => {
    const c = await auditarCapturando({ camposSensibles: ["", "_", "-", " (2)"], antes: { nombre: "Ana" }, despues: { nombre: "Beto" } });
    expect(c.despues).toEqual({ nombre: "Beto" });
    expect(c.cambios).toEqual([{ campo: "nombre", antes: "Ana", despues: "Beto" }]);
  });

  it('M6: "secretas" y "secretos" (plurales) se tapan', async () => {
    const c = await auditarCapturando({ antes: { secretas: ["PL1"], misSecretos: "PL2" }, despues: { secretas: ["PL3"], misSecretos: "PL4" } });
    expect(c.despues).toEqual({ secretas: "[redactado]", misSecretos: "[redactado]" });
    verificar(c, ["PL1", "PL2", "PL3", "PL4"]);
  });
});

describe("Fix round 1 (P.10b) — M4: getters rotos en tenantId/actor/ip/userAgent", () => {
  const trampa = (): never => {
    throw new Error("getter roto SECRETO-M4");
  };
  const casos: [string, (e: Record<string, unknown>) => void][] = [
    ["tenantId", (e) => Object.defineProperty(e, "tenantId", { get: trampa, enumerable: true })],
    ["actor", (e) => Object.defineProperty(e, "actor", { get: trampa, enumerable: true })],
    ["actor.tipo", (e) => { e.actor = Object.defineProperty({}, "tipo", { get: trampa, enumerable: true }); }],
    ["actor.id", (e) => { e.actor = Object.defineProperty({ tipo: "usuario" }, "id", { get: trampa, enumerable: true }); }],
    ["ip", (e) => Object.defineProperty(e, "ip", { get: trampa, enumerable: true })],
    ["userAgent", (e) => Object.defineProperty(e, "userAgent", { get: trampa, enumerable: true })],
  ];
  for (const [nombre, romper] of casos) {
    it(`un getter de ${nombre} que tira: { ok: false } "error preparando la auditoría", sin tocar la base`, async () => {
      const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
      const transaction = vi.fn(async () => {
        throw new Error("no debería llamarse");
      });
      try {
        const entrada: Record<string, unknown> = { tenantId: TENANT, entidad: "test", entidadId: "1", accion: "crear", actor: { tipo: "sistema" } };
        romper(entrada);
        const resultado = await auditar({ transaction } as unknown as DbCliente, tabla, entrada as unknown as EntradaAuditoria);
        expect(resultado).toEqual({ ok: false, error: { codigo: null, mensaje: "error preparando la auditoría" } });
        expect(transaction).not.toHaveBeenCalled();
        expect(spyError.mock.calls.flat().join(" ")).not.toContain("SECRETO-M4");
      } finally {
        spyError.mockRestore();
      }
    });
  }

  it("los valores capturados son los que viajan en el INSERT (tenant, actor, ip, userAgent)", async () => {
    const c = await auditarCapturando({ actor: { tipo: "usuario", id: "u-1" }, ip: "10.0.0.1", userAgent: "UA/1", despues: { a: 1 } });
    expect(c.params[0]).toBe(TENANT);
    expect(c.params[4]).toBe("usuario");
    expect(c.params[5]).toBe("u-1");
    expect(c.params[9]).toBe("10.0.0.1");
    expect(c.params[10]).toBe("UA/1");
  });
});

describe("Fix round 2 (P.10b) — D1: rutas con muchos puntos no bloquean", () => {
  const TOPE_MS = 200;

  it("una clave de ~10k puntos (con términos default y con uno con punto) se audita en < 200 ms", async () => {
    const sensible = `x${".".repeat(10_000)}password`;
    const inocente = `x${".".repeat(10_000)}y`;
    for (const camposSensibles of [undefined, ["api.key", "password"]]) {
      const inicio = performance.now();
      const c = await auditarCapturando({ camposSensibles, antes: { [sensible]: "DOS1", [inocente]: 1 }, despues: { [sensible]: "DOS2", [inocente]: 2 } });
      expect(performance.now() - inicio).toBeLessThan(TOPE_MS);
      expect(c.cambios).toContainEqual({ campo: sensible, antes: "[redactado]", despues: "[redactado]" });
      expect(c.cambios).toContainEqual({ campo: inocente, antes: 1, despues: 2 });
      verificar(c, ["DOS1", "DOS2"]);
    }
  });

  it("una ruta de 4000 segmentos (clave con puntos) se audita en < 200 ms, también con un término de 3 puntos", async () => {
    const clave = Array.from({ length: 4000 }, (_, i) => `s${i}`).join(".");
    for (const camposSensibles of [undefined, ["a.b.c.d"]]) {
      const inicio = performance.now();
      const c = await auditarCapturando({ camposSensibles, antes: { [clave]: 1 }, despues: { [clave]: 2 } });
      expect(performance.now() - inicio).toBeLessThan(TOPE_MS);
      expect(c.cambios).toEqual([{ campo: clave, antes: 1, despues: 2 }]);
    }
  });

  it("un objeto anidado 300 niveles con un término con punto se audita en < 200 ms", async () => {
    const armar = (hoja: string) => {
      let v: Record<string, unknown> = { cuenta: { numero: hoja } };
      for (let i = 0; i < 300; i++) v = { n: v };
      return v;
    };
    const inicio = performance.now();
    const c = await auditarCapturando({ camposSensibles: ["cuenta.numero"], antes: armar("PROF1"), despues: armar("PROF2") });
    expect(performance.now() - inicio).toBeLessThan(TOPE_MS);
    verificar(c, ["PROF1", "PROF2"]);
  });
});

describe("Fix round 2 (P.10b) — términos con punto también como ruta en las copias guardadas", () => {
  it('"cuenta.numero" tapa { cuenta: { numero } } en las copias Y en cambios, y sigue tapando la clave literal "cuenta.numero"', async () => {
    const c = await auditarCapturando({
      camposSensibles: ["cuenta.numero"],
      antes: { cuenta: { numero: "CN1", banco: "X" }, "cuenta.numero": "CL1" },
      despues: { cuenta: { numero: "CN2", banco: "X" }, "cuenta.numero": "CL2" },
    });
    expect(c.antes).toEqual({ cuenta: { numero: "[redactado]", banco: "X" }, "cuenta.numero": "[redactado]" });
    expect(c.despues).toEqual({ cuenta: { numero: "[redactado]", banco: "X" }, "cuenta.numero": "[redactado]" });
    expect(c.cambios).toEqual([
      { campo: "cuenta.numero", antes: "[redactado]", despues: "[redactado]" },
      { campo: "cuenta.numero", antes: "[redactado]", despues: "[redactado]" },
    ]);
    verificar(c, ["CN1", "CN2", "CL1", "CL2"]);
  });

  it("adentro de una hoja (arreglo) y de un Map: los arreglos no suman segmento, las claves de Map sí; copias y cambios coinciden", async () => {
    const c = await auditarCapturando({
      camposSensibles: ["l.cuenta", "m.numero"],
      antes: { l: [{ cuenta: "HL1" }], m: new Map([["numero", "HM1"]]), otro: [{ cuenta: "visible" }] },
      despues: { l: [{ cuenta: "HL2" }], m: new Map([["numero", "HM2"]]), otro: [{ cuenta: "visible" }] },
    });
    expect(c.despues).toEqual({ l: [{ cuenta: "[redactado]" }], m: { numero: "[redactado]" }, otro: [{ cuenta: "visible" }] });
    expect(c.cambios).toEqual([
      { campo: "l", antes: [{ cuenta: "[redactado]" }], despues: [{ cuenta: "[redactado]" }] },
      { campo: "m.numero", antes: "[redactado]", despues: "[redactado]" },
    ]);
    verificar(c, ["HL1", "HL2", "HM1", "HM2"]);
  });

  it("un término de 3 puntos matchea SOLO una ruta con exactamente esa cola", async () => {
    const valor = (s: string) => ({
      x: { a: { b: { c: { d: `${s}-si` } } } }, // cola exacta a.b.c.d
      corte: { b: { c: { d: `${s}-no1` } } }, // "corte.b.c.d" no termina en "a.b.c.d" ("corta" sí terminaría: regla "termina con")
      otra: { a: { b: { c: { e: `${s}-no2` } } } }, // termina en "e"
      d: { a: { b: { c: `${s}-no3` } } }, // los mismos nombres, en otro orden
    });
    const c = await auditarCapturando({ camposSensibles: ["a.b.c.d"], antes: valor("T3A"), despues: valor("T3B") });
    expect(c.despues).toEqual({
      x: { a: { b: { c: { d: "[redactado]" } } } },
      corte: { b: { c: { d: "T3B-no1" } } },
      otra: { a: { b: { c: { e: "T3B-no2" } } } },
      d: { a: { b: { c: "T3B-no3" } } },
    });
    verificar(c, ["T3A-si", "T3B-si"]);
  });

  it("los términos default se comportan igual que antes: { cuenta: { numero } } y { api: { key } } quedan visibles", async () => {
    const { puntosMaximos, normalizarTerminos } = await import("../../src/coincidencia-sensible.js");
    const { CAMPOS_SENSIBLES_POR_DEFECTO } = await import("../../src/redactar.js");
    expect(puntosMaximos(normalizarTerminos(CAMPOS_SENSIBLES_POR_DEFECTO))).toBe(0);
    const c = await auditarCapturando({ antes: { cuenta: { numero: 1 }, api: { key: "k1" }, token: "T1" }, despues: { cuenta: { numero: 2 }, api: { key: "k2" }, token: "T2" } });
    expect(c.despues).toEqual({ cuenta: { numero: 2 }, api: { key: "k2" }, token: "[redactado]" });
    verificar(c, ["T1", "T2"]);
  });
});

describe("Fix round 2 (P.10b) — \\p{Cc} y lectura única de antes/despues/camposSensibles", () => {
  it('"pass\\u0000word" y "tok\\u0007en" (caracteres de control) se tapan', async () => {
    const c = await auditarCapturando({ antes: { "pass\u0000word": "CC1", "tok\u0007en": "CC2" }, despues: { "pass\u0000word": "CC3", "tok\u0007en": "CC4" } });
    expect(c.despues).toEqual({ "pass\u0000word": "[redactado]", "tok\u0007en": "[redactado]" });
    verificar(c, ["CC1", "CC2", "CC3", "CC4"]);
  });

  for (const campo of ["antes", "despues", "camposSensibles"] as const) {
    it(`un getter de ${campo} que tira: { ok: false } "error preparando la auditoría", sin tocar la base`, async () => {
      const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
      const transaction = vi.fn(async () => {
        throw new Error("no debería llamarse");
      });
      try {
        const entrada: Record<string, unknown> = { tenantId: TENANT, entidad: "test", entidadId: "1", accion: "crear", actor: { tipo: "sistema" } };
        Object.defineProperty(entrada, campo, { get: () => { throw new Error("SECRETO-R2"); }, enumerable: true });
        const resultado = await auditar({ transaction } as unknown as DbCliente, tabla, entrada as unknown as EntradaAuditoria);
        expect(resultado).toEqual({ ok: false, error: { codigo: null, mensaje: "error preparando la auditoría" } });
        expect(transaction).not.toHaveBeenCalled();
        expect(spyError.mock.calls.flat().join(" ")).not.toContain("SECRETO-R2");
      } finally {
        spyError.mockRestore();
      }
    });
  }

  it("getters que devuelven algo distinto en cada lectura: se leen UNA vez, y el diff y las copias usan el mismo valor", async () => {
    const lecturas = { antes: 0, despues: 0, camposSensibles: 0 };
    const entrada: Record<string, unknown> = { tenantId: TENANT, entidad: "test", entidadId: "1", accion: "actualizar", actor: { tipo: "sistema" } };
    Object.defineProperty(entrada, "antes", { enumerable: true, get: () => (lecturas.antes++ === 0 ? { nombre: "Ana", pin: "P1" } : { nombre: "OTRO", pin: "FUGA-A" }) });
    Object.defineProperty(entrada, "despues", { enumerable: true, get: () => (lecturas.despues++ === 0 ? { nombre: "Beto", pin: "P2" } : { nombre: "OTRO", pin: "FUGA-D" }) });
    Object.defineProperty(entrada, "camposSensibles", { enumerable: true, get: () => (lecturas.camposSensibles++ === 0 ? ["pin"] : []) });
    const capturas: Capturado[] = [];
    const resultado = await auditar(dbQueCaptura(capturas), tabla, entrada as unknown as EntradaAuditoria);
    expect(resultado).toEqual({ ok: true, id: "id-falso" });
    expect(lecturas).toEqual({ antes: 1, despues: 1, camposSensibles: 1 });
    const c = capturas[0]!;
    expect(c.antes).toEqual({ nombre: "Ana", pin: "[redactado]" });
    expect(c.despues).toEqual({ nombre: "Beto", pin: "[redactado]" });
    verificar(c, ["P1", "P2", "FUGA-A", "FUGA-D", "OTRO"]);
  });
});
