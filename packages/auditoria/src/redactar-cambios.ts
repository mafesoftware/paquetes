import { CAMPOS_SENSIBLES_POR_DEFECTO, redactar } from "./redactar.js";
import { esClaveSensible, normalizarTerminos } from "./coincidencia-sensible.js";
import type { CambioAuditoria } from "./lo-que-cambio.js";

/** `" (2)"`, `" (3)"`… al final de un segmento — el sufijo que agrega la conversión de un `Map` cuando dos claves dan el mismo texto (puede repetirse: `"x (2) (2)"`). */
const SUFIJO_DE_COLISION = /(?: \(\d+\))+$/;

function segmentoSensible(segmento: string, sensibles: ReadonlySet<string>): boolean {
  return esClaveSensible(segmento, sensibles) || esClaveSensible(segmento.replace(SUFIJO_DE_COLISION, ""), sensibles);
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
 * - Si CUALQUIER segmento de la ruta es sensible (`"token.access"` lo es
 *   por `"token"`, aunque `"access"` no), cada lado DEFINIDO pasa a
 *   `"[redactado]"`: el valor nunca se ve, pero queda registrado QUE
 *   cambió. Un lado `undefined` (alta/baja) se deja `undefined`, para no
 *   fingir que había un valor. Un segmento con el sufijo de colisión de un
 *   `Map` (`"password (2)"`) se evalúa también sin el sufijo, así que
 *   sigue siendo sensible.
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
    const tieneSegmentoSensible = cambio.campo.split(".").some((segmento) => segmentoSensible(segmento, sensibles));
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
