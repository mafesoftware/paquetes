import { describe, expect, it } from "vitest";
import { loQueCambio, type CambioAuditoria } from "../src/lo-que-cambio.js";
import { CAMPOS_SENSIBLES_POR_DEFECTO, redactar } from "../src/redactar.js";
import { esClaveSensible, normalizarTerminos } from "../src/coincidencia-sensible.js";

/**
 * C1 (CRÍTICO, hallado en la revisión de P.10) y N1 (regresión que introdujo
 * el primer fix, hallada en la re-revisión).
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
 * de `cambios` por completo: `loQueCambio("[redactado]", "[redactado]")` es
 * `[]`. Ruling del controller: la auditoría TIENE que dejar constancia de
 * que un campo sensible cambió, sin su valor.
 *
 * **El fix final** (implementado en `src/drizzle/auditar.ts`,
 * `redactarCambios` interna) es el que este archivo reproduce acá, con
 * funciones exportadas del núcleo, para poder probarlo sin Postgres:
 *
 * 1. Diffear los valores CRUDOS con `loQueCambio` (nunca los redactados).
 * 2. Para cada cambio cuyo `campo` tenga CUALQUIER segmento sensible,
 *    reemplazar cada lado DEFINIDO por `"[redactado]"` (un lado `undefined`
 *    — alta/baja — se deja `undefined`).
 * 3. Para el resto, redactar cada lado con `redactar` (por si son objetos/
 *    arreglos/instancias/Map/Set con una clave sensible ADENTRO).
 *
 * El test de integración equivalente (contra el `jsonb` REAL insertado por
 * `auditar`, con `::text`) vive en `tests/drizzle/postgres.test.ts`.
 */
function redactarCambiosComoAuditar(
  cambios: CambioAuditoria[],
  camposSensibles: readonly string[] = CAMPOS_SENSIBLES_POR_DEFECTO,
): CambioAuditoria[] {
  const sensibles = normalizarTerminos(camposSensibles);
  return cambios.map((cambio) => {
    const tieneSegmentoSensible = cambio.campo.split(".").some((segmento) => esClaveSensible(segmento, sensibles));
    if (tieneSegmentoSensible) {
      return {
        campo: cambio.campo,
        antes: cambio.antes === undefined ? undefined : "[redactado]",
        despues: cambio.despues === undefined ? undefined : "[redactado]",
      };
    }
    return {
      campo: cambio.campo,
      antes: redactar(cambio.antes, camposSensibles),
      despues: redactar(cambio.despues, camposSensibles),
    };
  });
}

describe("N1 — un cambio en un campo sensible queda registrado (sin el valor), no desaparece", () => {
  it('un password que CAMBIÓ da UNA entrada "[redactado]"/"[redactado]" (no [])', () => {
    const cambios = redactarCambiosComoAuditar(loQueCambio({ password: "A" }, { password: "B" }));
    expect(cambios).toEqual([{ campo: "password", antes: "[redactado]", despues: "[redactado]" }]);
  });

  it("un password IGUAL (sin cambio real) sigue sin dejar ninguna entrada", () => {
    const cambios = redactarCambiosComoAuditar(loQueCambio({ password: "A" }, { password: "A" }));
    expect(cambios).toEqual([]);
  });

  it('C1: token.access que cambió da UNA entrada en "token.access" con los dos lados redactados, no vacío', () => {
    const cambios = redactarCambiosComoAuditar(loQueCambio({ token: { access: "AAA1" } }, { token: { access: "AAA2" } }));
    expect(cambios).toEqual([{ campo: "token.access", antes: "[redactado]", despues: "[redactado]" }]);
  });

  it("un arreglo de objetos con un password que cambió: la entrada del arreglo ENTERO, con los passwords redactados adentro", () => {
    const antes = { usuarios: [{ nombre: "Ana", password: "hunter2" }] };
    const despues = { usuarios: [{ nombre: "Ana", password: "hunter3" }] };
    const cambios = redactarCambiosComoAuditar(loQueCambio(antes, despues));
    expect(cambios).toEqual([
      {
        campo: "usuarios",
        antes: [{ nombre: "Ana", password: "[redactado]" }],
        despues: [{ nombre: "Ana", password: "[redactado]" }],
      },
    ]);
  });

  it("alta (antes ausente): el lado ausente queda undefined, no \"[redactado]\" (no había nada que tapar)", () => {
    const cambios = redactarCambiosComoAuditar(loQueCambio(undefined, { password: "nueva" }));
    expect(cambios).toEqual([{ campo: "password", antes: undefined, despues: "[redactado]" }]);
  });

  it("baja (despues ausente): mismo criterio, al revés", () => {
    const cambios = redactarCambiosComoAuditar(loQueCambio({ password: "vieja" }, undefined));
    expect(cambios).toEqual([{ campo: "password", antes: "[redactado]", despues: undefined }]);
  });

  it("ningún caso filtra el valor real: JSON.stringify de todos los resultados no contiene los secretos crudos", () => {
    const casos: [unknown, unknown][] = [
      [{ password: "A" }, { password: "B" }],
      [{ token: { access: "AAA1" } }, { token: { access: "AAA2" } }],
      [{ usuarios: [{ password: "hunter2" }] }, { usuarios: [{ password: "hunter3" }] }],
    ];
    for (const [antes, despues] of casos) {
      const cambios = redactarCambiosComoAuditar(loQueCambio(antes, despues));
      const crudo = JSON.stringify(cambios);
      expect(crudo).not.toContain('"A"');
      expect(crudo).not.toContain('"B"');
      expect(crudo).not.toContain("AAA1");
      expect(crudo).not.toContain("AAA2");
      expect(crudo).not.toContain("hunter2");
      expect(crudo).not.toContain("hunter3");
    }
  });

  it("un campo NO sensible que cambió sigue mostrando los valores reales, sin tocar", () => {
    const cambios = redactarCambiosComoAuditar(loQueCambio({ nombre: "Ana" }, { nombre: "Beatriz" }));
    expect(cambios).toEqual([{ campo: "nombre", antes: "Ana", despues: "Beatriz" }]);
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
    it(`${caso.nombre}: el fix (diffear crudo, redactar por segmento) no filtra el secreto`, () => {
      const cambios = redactarCambiosComoAuditar(loQueCambio(caso.antes, caso.despues));
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
    const cambiosCrudos = loQueCambio(antes, despues);
    const sensibles = normalizarTerminos(CAMPOS_SENSIBLES_POR_DEFECTO);
    // El bug: redactar mirando solo el ÚLTIMO segmento de la ruta ("access", nunca sensible).
    const conBugOriginal = cambiosCrudos.map((c) => {
      const ultimo = c.campo.split(".").at(-1) ?? c.campo;
      if (esClaveSensible(ultimo, sensibles)) return { ...c, antes: "[redactado]", despues: "[redactado]" };
      return c;
    });
    expect(JSON.stringify(conBugOriginal)).toContain("AAA1"); // reproduce el bug original
  });

  it("el bug de N1 (redactar antes/despues ENTEROS antes de diffear) hacía desaparecer el cambio — confirma que diffear CRUDO es necesario", () => {
    const antes = { token: { access: "AAA1" } };
    const despues = { token: { access: "AAA2" } };
    // El bug de la ronda 1: redactar ANTES de diffear.
    const antesRedactado = redactar(antes);
    const despuesRedactado = redactar(despues);
    const cambiosConBugDeRonda1 = loQueCambio(antesRedactado, despuesRedactado);
    expect(cambiosConBugDeRonda1).toEqual([]); // reproduce la regresión N1: el cambio desaparece
  });
});
