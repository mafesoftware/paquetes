/**
 * Lógica de matching de claves sensibles, COMPARTIDA entre `redactar`
 * (núcleo) y la redacción de `cambios` en `auditar` (`/drizzle`) — separada
 * acá para que las dos implementen EXACTAMENTE la misma regla, no una copia
 * que un día diverge.
 *
 * No se re-exporta desde `src/index.ts`: es un detalle de implementación
 * interno, no parte de la API pública del paquete (la API pública es
 * `redactar` con su parámetro `camposSensibles`).
 */

/** Minúsculas y sin `_`/`-`: así `"API-Key"`, `"apiKey"`, `"api_key"` y `"x-api-key"` normalizan al mismo texto. */
export function normalizarClave(clave: string): string {
  return clave.toLowerCase().replace(/[_-]/g, "");
}

/** `camposSensibles` ya normalizados, en un `Set` para lookup O(1). */
export function normalizarTerminos(camposSensibles: readonly string[]): Set<string> {
  return new Set(camposSensibles.map(normalizarClave));
}

/**
 * ¿`clave` es sensible? Sensible si su forma normalizada (minúsculas, sin
 * `_`/`-`) IGUALA a algún término de `terminosNormalizados`, o TERMINA CON
 * alguno. La regla "termina con" (no "contiene") es a propósito: cubre
 * variantes compuestas típicas —
 *
 * - `"passwordHash"` / `"password_hash"` (normalizan a `"passwordhash"`,
 *   terminan en `"hash"`)
 * - `"accessToken"` / `"refresh_token"` (`"accesstoken"`/`"refreshtoken"`,
 *   terminan en `"token"`)
 * - `"clientSecret"` (`"clientsecret"`, termina en `"secret"`)
 * - `"x-api-key"` (normaliza a `"xapikey"`, termina en `"apikey"`)
 *
 * — sin falsos positivos de claves donde el término sensible es un
 * PREFIJO, no un sufijo: `"passwordHint"` (normaliza a `"passwordhint"`,
 * NO termina en `"password"` — `"password"` queda al PRINCIPIO) y
 * `"tokenizer"` (`"tokenizer"`, NO termina en `"token"` — queda al
 * principio) NO se redactan. Un `"contiene"` en vez de `"termina con"`
 * hubiera tapado esos dos por error.
 *
 * **Límite documentado**: esto es matching por NOMBRE DE CLAVE, no por
 * valor. Un secreto guardado bajo una clave NO sensible (ej. `notas: "la
 * contraseña temporal es Xy9$zK"`) no se detecta — `redactar`/`auditar` no
 * miran el contenido de los strings, ver el JSDoc de `redactar`.
 */
export function esClaveSensible(clave: string, terminosNormalizados: ReadonlySet<string>): boolean {
  const normalizada = normalizarClave(clave);
  for (const termino of terminosNormalizados) {
    if (normalizada === termino || normalizada.endsWith(termino)) return true;
  }
  return false;
}
