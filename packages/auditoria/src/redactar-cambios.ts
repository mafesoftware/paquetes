import { CAMPOS_SENSIBLES_POR_DEFECTO, redactarConTerminos } from "./redactar.js";
import { esClaveSensible, normalizarTerminos } from "./coincidencia-sensible.js";
import type { CambioAuditoria } from "./lo-que-cambio.js";

/**
 * ¿Algún TRAMO contiguo de la ruta es sensible? La ruta se arma uniendo
 * claves con `"."`, pero una clave puede tener un punto adentro (`"api.key"`)
 * y un término también (`camposSensibles: ["api.key"]`): mirar solo cada
 * segmento suelto (`"api"`, `"key"`) no lo encontraría y el valor saldría en
 * claro en `cambios` mientras la copia guardada (que ve la clave entera) lo
 * tapa. Por eso se prueba cada unión `segmentos[i..j]` (con `j >= i`) — son
 * O(n²) llamadas sobre rutas cortas. Con un término sin punto, un tramo
 * largo nunca agrega nada que su último segmento no diera ya.
 */
function rutaSensible(campo: string, sensibles: ReadonlySet<string>): boolean {
  const segmentos = campo.split(".");
  for (let i = 0; i < segmentos.length; i++) {
    for (let j = i; j < segmentos.length; j++) {
      if (esClaveSensible(segmentos.slice(i, j + 1).join("."), sensibles)) return true;
    }
  }
  return false;
}

/**
 * Redacta `cambios`, el resultado de `loQueCambio` sobre valores
 * NORMALIZADOS (`normalizarParaDiff`) pero todavía SIN redactar. Es la
 * misma función que usa `auditar` (`/drizzle`); es pública (y no necesita
 * base de datos) para que una app que arma su propio registro pueda hacer
 * el mismo pipeline a mano:
 *
 * ```ts
 * import { loQueCambio, normalizarParaDiff, redactarCambios } from "@mafesoftware/auditoria";
 *
 * const cambios = redactarCambios(loQueCambio(normalizarParaDiff(antes), normalizarParaDiff(despues)));
 * // recién esto se puede guardar o loguear — nunca lo que devuelve normalizarParaDiff ni loQueCambio solos
 * ```
 *
 * A diferencia de `redactar` (que tapa por NOMBRE DE CLAVE de un objeto),
 * acá el nombre del campo sensible vive como VALOR de `campo` (ej.
 * `{ campo: "token.access", antes: "abc", despues: "xyz" }`) — por eso
 * `redactar` sobre el arreglo tal cual no alcanza.
 *
 * - Si CUALQUIER segmento de la ruta (o tramo contiguo de segmentos unidos
 *   con `"."`, para claves y términos que tienen un punto adentro) es sensible (`"token.access"` lo es
 *   por `"token"`, aunque `"access"` no), cada lado DEFINIDO pasa a
 *   `"[redactado]"`: el valor nunca se ve, pero queda registrado QUE
 *   cambió. Un lado `undefined` (alta/baja) se deja `undefined`, para no
 *   fingir que había un valor. Cada segmento pasa por el MISMO
 *   `esClaveSensible` que usa `redactar` (sin sufijo de colisión, sin
 *   acentos, minúsculas, sin separadores): `"password (2)"` y
 *   `"Contraseña"` son sensibles.
 * - Si no, cada lado pasa por `redactar` (puede ser un arreglo u objeto
 *   con una clave sensible ADENTRO — `loQueCambio` compara arreglos como
 *   valor entero).
 *
 * `camposSensibles` es por defecto `CAMPOS_SENSIBLES_POR_DEFECTO`, con la
 * misma regla de matching que `redactar` (igual o termina con, sobre la
 * forma normalizada).
 *
 * ```ts
 * redactarCambios([{ campo: "m.password", antes: "A", despues: "B" }, { campo: "nombre", antes: "Ana", despues: "Beto" }]);
 * // [{ campo: "m.password", antes: "[redactado]", despues: "[redactado]" }, { campo: "nombre", antes: "Ana", despues: "Beto" }]
 * ```
 */
export function redactarCambios(
  cambios: readonly CambioAuditoria[],
  camposSensibles: readonly string[] = CAMPOS_SENSIBLES_POR_DEFECTO,
): CambioAuditoria[] {
  const sensibles = normalizarTerminos(camposSensibles);
  return cambios.map((cambio) => {
    const tieneSegmentoSensible = rutaSensible(cambio.campo, sensibles);
    if (tieneSegmentoSensible) {
      return {
        campo: cambio.campo,
        antes: cambio.antes === undefined ? undefined : "[redactado]",
        despues: cambio.despues === undefined ? undefined : "[redactado]",
      };
    }
    return {
      campo: cambio.campo,
      antes: redactarConTerminos(cambio.antes, sensibles),
      despues: redactarConTerminos(cambio.despues, sensibles),
    };
  });
}
