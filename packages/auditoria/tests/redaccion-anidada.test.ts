import { describe, expect, it } from "vitest";
import { loQueCambio } from "../src/lo-que-cambio.js";
import { redactar } from "../src/redactar.js";

/**
 * C1 (CRÍTICO, hallado en la revisión de P.10): un secreto ANIDADO bajo una
 * clave ANCESTRO sensible se filtraba a `cambios`. `loQueCambio` calculaba
 * el diff sobre los valores CRUDOS (`entrada.antes`/`entrada.despues`) y
 * recién DESPUÉS `redactarCambios` (la versión vieja, ya borrada) miraba
 * solo el ÚLTIMO segmento de la ruta — `"token.access"` → `"access"`, que
 * no es un nombre sensible, así que el valor real de `token.access`
 * quedaba en la fila de auditoría, redacción o no.
 *
 * El fix es estructural: `auditar` ahora corre `redactar(entrada.antes)` /
 * `redactar(entrada.despues)` ANTES de pasarlos a `loQueCambio` — `redactar`
 * SÍ mira todos los ancestros de una ruta (tapa la clave `"token"` entera,
 * no busca por el nombre final), así que `loQueCambio` nunca llega a ver el
 * secreto. Este archivo prueba esa COMPOSICIÓN (`loQueCambio(redactar(x),
 * redactar(y))`, exactamente el patrón que usa `auditar`) a nivel unitario,
 * sin Postgres — el test de integración equivalente (contra el `jsonb`
 * crudo insertado de verdad) vive en `tests/drizzle/postgres.test.ts`.
 */
describe("C1 — secretos anidados bajo una clave ancestro sensible (redactar ANTES de loQueCambio)", () => {
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
    it(`${caso.nombre}: el patrón redactar-antes-de-diffear (el que usa auditar) no filtra el secreto en antes/despues/cambios`, () => {
      const antesRedactado = redactar(caso.antes);
      const despuesRedactado = redactar(caso.despues);
      const cambios = loQueCambio(antesRedactado, despuesRedactado);

      const crudo = JSON.stringify({ antesRedactado, despuesRedactado, cambios });
      for (const secreto of caso.secretos) {
        expect(crudo).not.toContain(secreto);
      }
    });
  }

  it("arreglo de objetos con password adentro: redactar tapa cada elemento, loQueCambio sobre lo redactado no filtra nada", () => {
    const antes = { usuarios: [{ nombre: "Ana", password: "hunter2" }] };
    const despues = { usuarios: [{ nombre: "Ana", password: "hunter3" }] };

    const antesRedactado = redactar(antes);
    const despuesRedactado = redactar(despues);
    const cambios = loQueCambio(antesRedactado, despuesRedactado);

    const crudo = JSON.stringify({ antesRedactado, despuesRedactado, cambios });
    expect(crudo).not.toContain("hunter2");
    expect(crudo).not.toContain("hunter3");
  });

  it("documenta el bug original (C1): diffear los valores CRUDOS (sin redactar antes) SÍ filtraba el secreto", () => {
    // El bug de la versión anterior: `loQueCambio(entrada.antes,
    // entrada.despues)` corría sobre los valores CRUDOS, y la redacción
    // posterior solo miraba el ÚLTIMO segmento de la ruta ("access", que
    // nunca es un término sensible) — "token" (el ancestro sensible de
    // verdad) quedaba sin chequear. Este test corre a propósito el paso
    // "roto" (diffear sin redactar antes) para demostrar que el secreto
    // SÍ aparece ahí — lo que confirma que redactar ANTES (el fix, probado
    // en los tests de arriba) es necesario, no cosmético.
    const antes = { token: { access: "AAA1" } };
    const despues = { token: { access: "AAA2" } };

    const cambiosCrudos = loQueCambio(antes, despues); // SIN redactar antes: el paso que tenía el bug.
    expect(JSON.stringify(cambiosCrudos)).toContain("AAA1");
    expect(JSON.stringify(cambiosCrudos)).toContain("AAA2");
  });
});
