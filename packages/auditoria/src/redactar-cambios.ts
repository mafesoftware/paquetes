import { CAMPOS_SENSIBLES_POR_DEFECTO, redactarConTerminos } from "./redactar.js";
import { colaSensible, normalizarClave, normalizarTerminos, puntosMaximos } from "./coincidencia-sensible.js";
import { esCambioDeRaiz, type CambioAuditoria } from "./lo-que-cambio.js";

/**
 * ¿Algún tramo contiguo de la ruta es sensible? La ruta se arma uniendo
 * claves con `"."`, pero una clave puede tener un punto adentro (`"api.key"`)
 * y un término también (`camposSensibles: ["api.key"]`): mirar solo cada
 * segmento suelto (`"api"`, `"key"`) no lo encontraría. Para una regla de
 * "igual o termina con" alcanza con las COLAS que terminan en cada segmento,
 * de a lo sumo `maxPuntos + 1` segmentos (`colaSensible`): lineal en la
 * longitud de la ruta, no cúbico.
 */
function rutaSensible(normalizados: readonly string[], sensibles: ReadonlySet<string>, maxPuntos: number): boolean {
  for (let fin = 0; fin < normalizados.length; fin++) {
    if (colaSensible(normalizados, fin, sensibles, maxPuntos)) return true;
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
  const maxPuntos = puntosMaximos(sensibles);
  return cambios.map((cambio) => {
    // P2 (ronda de fix 3): la raíz verdadera la marca `loQueCambio` aparte
    // (`esCambioDeRaiz`), no el texto `"(raiz)"` — una clave REAL `"(raiz)"`
    // es un segmento como cualquier otro.
    const segmentos = esCambioDeRaiz(cambio) ? [] : cambio.campo.split(".");
    const normalizados = segmentos.map(normalizarClave);
    const tieneSegmentoSensible = rutaSensible(normalizados, sensibles, maxPuntos);
    if (tieneSegmentoSensible) {
      return {
        campo: cambio.campo,
        antes: cambio.antes === undefined ? undefined : "[redactado]",
        despues: cambio.despues === undefined ? undefined : "[redactado]",
      };
    }
    return {
      campo: cambio.campo,
      // La ruta del cambio es la ruta de claves de los ancestros de la hoja:
      // así un término con punto ("l.cuenta") tapa igual que en las copias.
      antes: redactarConTerminos(cambio.antes, sensibles, segmentos),
      despues: redactarConTerminos(cambio.despues, sensibles, segmentos),
    };
  });
}
