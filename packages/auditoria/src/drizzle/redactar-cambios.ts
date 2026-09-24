import { redactar } from "../redactar.js";
import { esClaveSensible, normalizarTerminos } from "../coincidencia-sensible.js";
import type { CambioAuditoria } from "../lo-que-cambio.js";

/**
 * Redacta `cambios` (el resultado de `loQueCambio` sobre los valores
 * NORMALIZADOS pero SIN redactar — ver el JSDoc de `auditar`, sección
 * "Cómo se evita que un secreto llegue a `cambios`").
 *
 * A diferencia de `redactar` (que tapa por NOMBRE DE CLAVE de un objeto),
 * acá el nombre del campo sensible vive como VALOR de `campo` (ej.
 * `{ campo: "token.access", antes: "abc", despues: "xyz" }`), no como
 * clave — así que correr `redactar` sobre el arreglo TAL CUAL no
 * alcanzaría: las claves de cada entrada son `"campo"`, `"antes"`,
 * `"despues"`, ninguna sensible por sí misma.
 *
 * Chequea CUALQUIER segmento de la ruta con puntos (no solo el último): si
 * `"token.access"` matchea porque `"token"` es sensible (aunque `"access"`
 * no lo sea), el VALOR entero de esa entrada se reemplaza por
 * `"[redactado]"` en cada lado que esté DEFINIDO — un lado `undefined`
 * (típico de un alta/baja: no había "antes", o no queda "despues") se deja
 * `undefined`, para no fingir que había un valor ahí. Para un cambio que
 * NO tiene ningún segmento sensible en su ruta, igual se corre `redactar`
 * sobre cada lado (`antes`/`despues` pueden ser objetos, arreglos,
 * instancias, `Map`s o `Set`s con una clave sensible ADENTRO — ej. un
 * arreglo de objetos donde cambió un `password` en algún elemento).
 *
 * Vive en su propio archivo (M-c de la revisión de P.10, ronda 4) para que
 * los tests puedan importar la función REAL en vez de mantener una copia
 * duplicada — no se re-exporta desde `drizzle/index.ts`: es un detalle de
 * implementación de `auditar`, no parte de la API pública del paquete.
 */
export function redactarCambios(cambios: CambioAuditoria[], camposSensibles: readonly string[]): CambioAuditoria[] {
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
