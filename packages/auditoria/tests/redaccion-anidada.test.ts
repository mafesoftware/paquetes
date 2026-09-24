import { describe, expect, it } from "vitest";
import { loQueCambio, type CambioAuditoria } from "../src/lo-que-cambio.js";
import { CAMPOS_SENSIBLES_POR_DEFECTO, redactar } from "../src/redactar.js";
import { esClaveSensible, normalizarTerminos } from "../src/coincidencia-sensible.js";
import { normalizarParaDiff } from "../src/normalizar-para-diff.js";
import { serializarParaAuditoria } from "../src/serializar.js";
import { redactarCambios } from "../src/drizzle/redactar-cambios.js";

/**
 * C1 (CRÍTICO, hallado en la revisión de P.10), N1 (regresión que introdujo
 * el primer fix de C1) y la regresión IMPORTANTE de la ronda 4 (diffear
 * valores CRUDOS hacía que instancias equivalentes se vieran "cambiadas").
 *
 * **C1**: un secreto ANIDADO bajo una clave ANCESTRO sensible se filtraba a
 * `cambios` — `loQueCambio` corría sobre los valores CRUDOS y la redacción
 * posterior solo miraba el ÚLTIMO segmento de la ruta (`"token.access"` →
 * `"access"`, nunca sensible).
 *
 * **N1** (la regresión de la primera ronda de fix): para tapar C1, esa
 * primera ronda redactaba `antes`/`despues` ENTEROS con `redactar` ANTES de
 * diffearlos con `loQueCambio` — así `loQueCambio` nunca veía el secreto,
 * pero como los DOS lados de un campo sensible quedaban con el MISMO string
 * `"[redactado]"`, un cambio REAL en ese campo (`"A"` → `"B"`) desaparecía
 * de `cambios` por completo. Ruling del controller: la auditoría TIENE que
 * dejar constancia de que un campo sensible cambió, sin su valor.
 *
 * **La regresión de la ronda 4** (Importante, hallada en la re-revisión):
 * el fix final de N1 volvió a diffear los valores CRUDOS con `loQueCambio`
 * — pero dos instancias DISTINTAS con el MISMO valor semántico (dos
 * `Decimal`-like separados con el mismo `toJSON()`, dos `Map`s con las
 * mismas entradas, dos `URL` para la misma dirección, dos instancias de
 * una clase con los mismos campos) nunca son `===` ni comparables
 * estructuralmente tal como llegan — `loQueCambio` las reportaba como
 * "cambiadas" aunque nada hubiera cambiado. Ruling: agregar
 * `normalizarParaDiff` (mismas reglas de tipos especiales que
 * `serializarParaAuditoria`, sin redactar) ANTES de diffear.
 *
 * **El flujo final** (el que usa `auditar`, `src/drizzle/auditar.ts`), que
 * este archivo reproduce con las funciones REALES (M-c: `redactarCambios`
 * se importa de `src/drizzle/redactar-cambios.ts`, no se duplica acá):
 *
 * 1. Normalizar `antes`/`despues` con `normalizarParaDiff` (SIN redactar).
 * 2. Diffear los valores NORMALIZADOS con `loQueCambio`.
 * 3. Para cada cambio cuyo `campo` tenga CUALQUIER segmento sensible,
 *    reemplazar cada lado DEFINIDO por `"[redactado]"` (un lado `undefined`
 *    — alta/baja — se deja `undefined`).
 * 4. Para el resto, redactar cada lado con `redactar` (por si son objetos/
 *    arreglos/instancias/Map/Set con una clave sensible ADENTRO).
 *
 * El test de integración equivalente (contra el `jsonb` REAL insertado por
 * `auditar`, con `::text`) vive en `tests/drizzle/postgres.test.ts`.
 */
function cambiosComoAuditar(
  antes: unknown,
  despues: unknown,
  camposSensibles: readonly string[] = CAMPOS_SENSIBLES_POR_DEFECTO,
): CambioAuditoria[] {
  const cambiosCrudos = loQueCambio(normalizarParaDiff(antes), normalizarParaDiff(despues));
  return redactarCambios(cambiosCrudos, camposSensibles);
}

describe("N1 — un cambio en un campo sensible queda registrado (sin el valor), no desaparece", () => {
  it('un password que CAMBIÓ da UNA entrada "[redactado]"/"[redactado]" (no [])', () => {
    expect(cambiosComoAuditar({ password: "A" }, { password: "B" })).toEqual([
      { campo: "password", antes: "[redactado]", despues: "[redactado]" },
    ]);
  });

  it("un password IGUAL (sin cambio real) sigue sin dejar ninguna entrada", () => {
    expect(cambiosComoAuditar({ password: "A" }, { password: "A" })).toEqual([]);
  });

  it('C1: token.access que cambió da UNA entrada en "token.access" con los dos lados redactados, no vacío', () => {
    expect(cambiosComoAuditar({ token: { access: "AAA1" } }, { token: { access: "AAA2" } })).toEqual([
      { campo: "token.access", antes: "[redactado]", despues: "[redactado]" },
    ]);
  });

  it("un arreglo de objetos con un password que cambió: la entrada del arreglo ENTERO, con los passwords redactados adentro", () => {
    const antes = { usuarios: [{ nombre: "Ana", password: "hunter2" }] };
    const despues = { usuarios: [{ nombre: "Ana", password: "hunter3" }] };
    expect(cambiosComoAuditar(antes, despues)).toEqual([
      {
        campo: "usuarios",
        antes: [{ nombre: "Ana", password: "[redactado]" }],
        despues: [{ nombre: "Ana", password: "[redactado]" }],
      },
    ]);
  });

  it("alta (antes ausente): el lado ausente queda undefined, no \"[redactado]\" (no había nada que tapar)", () => {
    expect(cambiosComoAuditar(undefined, { password: "nueva" })).toEqual([
      { campo: "password", antes: undefined, despues: "[redactado]" },
    ]);
  });

  it("baja (despues ausente): mismo criterio, al revés", () => {
    expect(cambiosComoAuditar({ password: "vieja" }, undefined)).toEqual([
      { campo: "password", antes: "[redactado]", despues: undefined },
    ]);
  });

  it("ningún caso filtra el valor real: JSON.stringify de todos los resultados no contiene los secretos crudos", () => {
    const casos: [unknown, unknown][] = [
      [{ password: "A" }, { password: "B" }],
      [{ token: { access: "AAA1" } }, { token: { access: "AAA2" } }],
      [{ usuarios: [{ password: "hunter2" }] }, { usuarios: [{ password: "hunter3" }] }],
    ];
    for (const [antes, despues] of casos) {
      const crudo = JSON.stringify(cambiosComoAuditar(antes, despues));
      expect(crudo).not.toContain('"A"');
      expect(crudo).not.toContain('"B"');
      expect(crudo).not.toContain("AAA1");
      expect(crudo).not.toContain("AAA2");
      expect(crudo).not.toContain("hunter2");
      expect(crudo).not.toContain("hunter3");
    }
  });

  it("un campo NO sensible que cambió sigue mostrando los valores reales, sin tocar", () => {
    expect(cambiosComoAuditar({ nombre: "Ana" }, { nombre: "Beatriz" })).toEqual([
      { campo: "nombre", antes: "Ana", despues: "Beatriz" },
    ]);
  });
});

describe("C1 (unitario) — secretos anidados bajo una clave ancestro sensible", () => {
  const CASOS: { nombre: string; antes: unknown; despues: unknown; secretos: string[] }[] = [
    {
      nombre: "authorization.bearer",
      antes: { authorization: { bearer: "AAA1" } },
      despues: { authorization: { bearer: "AAA2" } },
      secretos: ["AAA1", "AAA2"],
    },
    {
      nombre: "clave.actual",
      antes: { clave: { actual: "SECRETO9" } },
      despues: { clave: { actual: "SECRETO10" } },
      secretos: ["SECRETO9", "SECRETO10"],
    },
    {
      nombre: "token.refresh",
      antes: { token: { refresh: "RRR1" } },
      despues: { token: { refresh: "RRR2" } },
      secretos: ["RRR1", "RRR2"],
    },
    {
      nombre: "secret.value",
      antes: { secret: { value: "VVV1" } },
      despues: { secret: { value: "VVV2" } },
      secretos: ["VVV1", "VVV2"],
    },
  ];

  for (const caso of CASOS) {
    it(`${caso.nombre}: el fix (diffear normalizado, redactar por segmento) no filtra el secreto`, () => {
      const cambios = cambiosComoAuditar(caso.antes, caso.despues);
      const crudo = JSON.stringify(cambios);
      for (const secreto of caso.secretos) {
        expect(crudo).not.toContain(secreto);
      }
      // Y SÍ queda registrado que el campo cambió (no una lista vacía, la regresión N1).
      expect(cambios.length).toBeGreaterThan(0);
    });
  }

  it("el bug ORIGINAL de C1 (redactar solo por el último segmento de la ruta) SÍ filtraba el secreto — confirma que mirar TODOS los segmentos es necesario", () => {
    const antes = { token: { access: "AAA1" } };
    const despues = { token: { access: "AAA2" } };
    const cambiosCrudos = loQueCambio(normalizarParaDiff(antes), normalizarParaDiff(despues));
    const sensibles = normalizarTerminos(CAMPOS_SENSIBLES_POR_DEFECTO);
    // El bug: redactar mirando solo el ÚLTIMO segmento de la ruta ("access", nunca sensible).
    const conBugOriginal = cambiosCrudos.map((c) => {
      const ultimo = c.campo.split(".").at(-1) ?? c.campo;
      if (esClaveSensible(ultimo, sensibles)) return { ...c, antes: "[redactado]", despues: "[redactado]" };
      return c;
    });
    expect(JSON.stringify(conBugOriginal)).toContain("AAA1"); // reproduce el bug original
  });

  it("el bug de N1 (redactar antes/despues ENTEROS antes de diffear) hacía desaparecer el cambio — confirma que diffear sin redactar es necesario", () => {
    const antes = { token: { access: "AAA1" } };
    const despues = { token: { access: "AAA2" } };
    // El bug de la ronda 1: redactar ANTES de diffear.
    const antesRedactado = redactar(antes);
    const despuesRedactado = redactar(despues);
    const cambiosConBugDeRonda1 = loQueCambio(antesRedactado, despuesRedactado);
    expect(cambiosConBugDeRonda1).toEqual([]); // reproduce la regresión N1: el cambio desaparece
  });
});

describe("Regresión de la ronda 4 — instancias EQUIVALENTES (no idénticas) no se reportan como cambiadas", () => {
  it("dos instancias Decimal-like SEPARADAS, mismo toJSON (\"12.50\"): sin entrada", () => {
    class Decimal {
      constructor(private texto: string) {}
      toJSON(): string {
        return this.texto;
      }
    }
    expect(cambiosComoAuditar({ precio: new Decimal("12.50") }, { precio: new Decimal("12.50") })).toEqual([]);
  });

  it("dos Decimal-like con VALOR distinto: SÍ hay una entrada (no se pierde el cambio real)", () => {
    class Decimal {
      constructor(private texto: string) {}
      toJSON(): string {
        return this.texto;
      }
    }
    expect(cambiosComoAuditar({ precio: new Decimal("12.50") }, { precio: new Decimal("15.00") })).toEqual([
      { campo: "precio", antes: "12.50", despues: "15.00" },
    ]);
  });

  it("dos Maps iguales (mismas entradas, mismo orden), instancias separadas: sin entrada", () => {
    const m1 = new Map([["a", 1], ["b", 2]]);
    const m2 = new Map([["a", 1], ["b", 2]]);
    expect(cambiosComoAuditar({ datos: m1 }, { datos: m2 })).toEqual([]);
  });

  it("dos URLs iguales, instancias separadas: sin entrada", () => {
    const u1 = new URL("https://api.com/perfil");
    const u2 = new URL("https://api.com/perfil");
    expect(cambiosComoAuditar({ url: u1 }, { url: u2 })).toEqual([]);
  });

  it("dos instancias Usuario iguales (mismos campos), separadas: sin entrada", () => {
    class Usuario {
      constructor(
        public nombre: string,
        public activo: boolean,
      ) {}
    }
    expect(cambiosComoAuditar({ u: new Usuario("Ana", true) }, { u: new Usuario("Ana", true) })).toEqual([]);
  });

  it("un objeto PLANO con su propio toJSON que enmascara el dni: cambios coincide con las copias guardadas y NO tiene una entrada \"d.toJSON\"", () => {
    const crearD = (dni: string) => ({
      dni,
      nombre: "Ana",
      toJSON() {
        return { dniEnmascarado: `***${dni.slice(-4)}`, nombre: "Ana" };
      },
    });

    // Mismo dni de los dos lados: semánticamente NO cambió nada, aunque
    // sean dos instancias/closures distintas (con su propio toJSON, propio
    // por referencia, nunca === entre sí).
    const antes = { d: crearD("20111111119") };
    const despues = { d: crearD("20111111119") };

    const cambios = cambiosComoAuditar(antes, despues);
    expect(cambios).toEqual([]);
    expect(cambios.some((c) => c.campo === "d.toJSON")).toBe(false);
    expect(cambios.some((c) => c.campo.includes("toJSON"))).toBe(false);

    // "cambios coincide con las copias guardadas": las fotos completas que
    // auditar guarda (antes/despues, vía redactar + serializarParaAuditoria,
    // que TAMBIÉN llaman a toJSON) dan el mismo resultado en los dos lados.
    const antesGuardado = serializarParaAuditoria(redactar(antes));
    const despuesGuardado = serializarParaAuditoria(redactar(despues));
    expect(antesGuardado).toEqual(despuesGuardado);
    expect(antesGuardado).toEqual({ d: { dniEnmascarado: "***1119", nombre: "Ana" } });
  });

  it("el mismo caso del dni, pero con un dni REALMENTE distinto: SÍ hay una entrada, y la copia guardada también difiere", () => {
    const crearD = (dni: string) => ({
      dni,
      nombre: "Ana",
      toJSON() {
        return { dniEnmascarado: `***${dni.slice(-4)}`, nombre: "Ana" };
      },
    });

    const antes = { d: crearD("20111111119") };
    const despues = { d: crearD("20222222229") };

    const cambios = cambiosComoAuditar(antes, despues);
    expect(cambios).toEqual([{ campo: "d.dniEnmascarado", antes: "***1119", despues: "***2229" }]);

    const antesGuardado = serializarParaAuditoria(redactar(antes));
    const despuesGuardado = serializarParaAuditoria(redactar(despues));
    expect(antesGuardado).not.toEqual(despuesGuardado);
  });
});
