import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validarCuit } from "../src/cuit.ts";
import { validarCbu, validarCvu } from "../src/cbu.ts";

/**
 * Property-based tests (fast-check), independientes de la implementación:
 * cada uno reimplementa su propio cálculo de dígito verificador acá mismo,
 * en vez de importarlo de `src/`, para que un bug sistemático en el cálculo
 * de producción no quede invisible por compartir la misma cuenta.
 *
 * ## Por qué la propiedad "alterar un dígito invalida" vale SIEMPRE acá
 *
 * Un checksum no siempre detecta cualquier cambio de un solo dígito: si el
 * peso de una posición comparte factor con el módulo, dos dígitos distintos
 * en esa posición pueden dar la misma suma ponderada módulo el divisor, y la
 * alteración pasa desapercibida. Acá NO pasa, y por eso no hace falta acotar
 * la propiedad a una clase "detectable":
 *
 * - **CUIT** (módulo 11): 11 es primo, así que cualquier peso de 2 a 10 es
 *   coprimo con 11. Cambiar un dígito en una posición ponderada por un
 *   delta no nulo (1-9) mueve la suma ponderada en `peso · delta mod 11`,
 *   que nunca es 0 (ni `peso` ni `delta` son múltiplos de 11). El propio
 *   dígito verificador (posición 11) se compara directo: cualquier cambio
 *   ahí también se detecta trivialmente.
 * - **CBU/CVU** (módulo 10): los pesos usados (7,1,3,9 en el bloque 1;
 *   3,9,7,1 en el bloque 2) son todos coprimos con 10 — son exactamente las
 *   unidades módulo 10 ({1,3,7,9}) —, así que el mismo argumento aplica con
 *   módulo 10 en vez de 11. Los dígitos verificadores (posiciones 8 y 22)
 *   también se comparan directo.
 *
 * Verificado por fuerza bruta además de por el argumento algebraico: los
 * tests de abajo corren cientos de casos al azar, alterando cada una de las
 * 11 (CUIT) o 22 (CBU/CVU) posiciones, y ninguno encontró una alteración que
 * sobreviviera.
 */

const OCHO_DIGITOS = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 8, maxLength: 8 }).map((a) => a.join(""));
const PREFIJOS_CUIT = ["20", "23", "24", "27", "30", "33", "34"] as const;

/** DV de CUIT, calculado independientemente de `src/cuit.ts`. */
function dvCuitIndependiente(diez: string): number {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let suma = 0;
  for (let i = 0; i < 10; i++) suma += Number(diez.charAt(i)) * pesos[i]!;
  const resto = suma % 11;
  return resto === 0 ? 0 : 11 - resto;
}

describe("propiedades: CUIT", () => {
  it("un CUIT armado con el DV calculado siempre valida, para cualquier prefijo válido y cualquier DNI de 8 dígitos", () => {
    fc.assert(
      fc.property(fc.constantFrom(...PREFIJOS_CUIT), OCHO_DIGITOS, (prefijo, dni) => {
        const diez = prefijo + dni;
        const dv = dvCuitIndependiente(diez);
        // DV=10 no es representable en un solo dígito (caso documentado en
        // cuit.ts, regla 23/33): no es lo que prueba esta propiedad.
        fc.pre(dv <= 9);
        const cuit = diez + String(dv);
        expect(validarCuit(cuit)).toEqual({ ok: true, normalizado: cuit, tipo: expect.any(String) });
      }),
    );
  });

  it("alterar cualquiera de los 11 dígitos de un CUIT válido siempre lo invalida", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PREFIJOS_CUIT),
        OCHO_DIGITOS,
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 1, max: 9 }),
        (prefijo, dni, indice, corrimiento) => {
          const diez = prefijo + dni;
          const dv = dvCuitIndependiente(diez);
          fc.pre(dv <= 9);
          const cuit = diez + String(dv);

          const original = Number(cuit.charAt(indice));
          const nuevo = (original + corrimiento) % 10; // siempre distinto de `original`
          const alterado = cuit.slice(0, indice) + String(nuevo) + cuit.slice(indice + 1);

          expect(validarCuit(alterado).ok).toBe(false);
        },
      ),
    );
  });
});

const SIETE_DIGITOS = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 7, maxLength: 7 }).map((a) => a.join(""));
const TRECE_DIGITOS = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 13, maxLength: 13 }).map((a) => a.join(""));

/** DV de un bloque de CBU/CVU, calculado independientemente de `src/cbu.ts`. */
function dvBloqueIndependiente(digitos: string, pesos: readonly number[]): number {
  let suma = 0;
  for (let i = 0; i < pesos.length; i++) suma += Number(digitos.charAt(i)) * pesos[i]!;
  return (10 - (suma % 10)) % 10;
}

function armarCbu(bancoYSucursal: string, cuenta: string): string {
  const dv1 = dvBloqueIndependiente(bancoYSucursal, [7, 1, 3, 9, 7, 1, 3]);
  const dv2 = dvBloqueIndependiente(cuenta, [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]);
  return `${bancoYSucursal}${dv1}${cuenta}${dv2}`;
}

describe("propiedades: CBU", () => {
  it("un CBU armado con los DV calculados siempre valida, para banco+sucursal y cuenta al azar (sin prefijo 000)", () => {
    fc.assert(
      fc.property(SIETE_DIGITOS, TRECE_DIGITOS, (bancoYSucursal, cuenta) => {
        fc.pre(bancoYSucursal.slice(0, 3) !== "000"); // eso es un CVU, no el foco de esta propiedad
        const cbu = armarCbu(bancoYSucursal, cuenta);
        expect(validarCbu(cbu)).toEqual({ ok: true, normalizado: cbu, banco: bancoYSucursal.slice(0, 3) });
      }),
    );
  });

  it("alterar cualquiera de los 22 dígitos de un CBU válido siempre lo invalida", () => {
    fc.assert(
      fc.property(
        SIETE_DIGITOS,
        TRECE_DIGITOS,
        fc.integer({ min: 0, max: 21 }),
        fc.integer({ min: 1, max: 9 }),
        (bancoYSucursal, cuenta, indice, corrimiento) => {
          fc.pre(bancoYSucursal.slice(0, 3) !== "000");
          const cbu = armarCbu(bancoYSucursal, cuenta);

          const original = Number(cbu.charAt(indice));
          const nuevo = (original + corrimiento) % 10;
          const alterado = cbu.slice(0, indice) + String(nuevo) + cbu.slice(indice + 1);

          // Puede volverse inválido por dígito verificador o (si se tocó el
          // prefijo) por parecer un CVU — cualquiera de los dos es `ok:
          // false`, que es lo que prueba esta propiedad.
          expect(validarCbu(alterado).ok).toBe(false);
        },
      ),
    );
  });
});

describe("propiedades: CVU", () => {
  const CUATRO_DIGITOS = fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 4, maxLength: 4 }).map((a) => a.join(""));

  it("un CVU armado con los DV calculados siempre valida, para sucursal y cuenta al azar", () => {
    fc.assert(
      fc.property(CUATRO_DIGITOS, TRECE_DIGITOS, (sucursal, cuenta) => {
        const cvu = armarCbu(`000${sucursal}`, cuenta);
        expect(validarCvu(cvu)).toEqual({ ok: true, normalizado: cvu });
      }),
    );
  });

  it("alterar cualquiera de los 22 dígitos de un CVU válido siempre lo invalida", () => {
    fc.assert(
      fc.property(
        CUATRO_DIGITOS,
        TRECE_DIGITOS,
        fc.integer({ min: 0, max: 21 }),
        fc.integer({ min: 1, max: 9 }),
        (sucursal, cuenta, indice, corrimiento) => {
          const cvu = armarCbu(`000${sucursal}`, cuenta);

          const original = Number(cvu.charAt(indice));
          const nuevo = (original + corrimiento) % 10;
          const alterado = cvu.slice(0, indice) + String(nuevo) + cvu.slice(indice + 1);

          expect(validarCvu(alterado).ok).toBe(false);
        },
      ),
    );
  });
});
