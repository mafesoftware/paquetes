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

/**
 * `" (2)"`, `" (3)"`… al FINAL de la clave — el sufijo que agrega la
 * conversión de un `Map` a objeto cuando dos claves dan el mismo texto
 * (`entradasDeMap`). Puede repetirse (`"x (2) (2)"`, si la clave original ya
 * terminaba en `" (2)"`), por eso el `+`: se sacan todos.
 */
const SUFIJO_DE_COLISION = /(?: \(\d+\))+$/;

/**
 * Lo que se borra después de `NFKD`: marcas combinantes (`\p{M}`, lo que
 * queda de un acento: `"ñ"` → `"n"` + `"\u0303"`) y caracteres de formato
 * (`\p{Cf}`: espacio de ancho cero `U+200B`, unidores `U+200C`/`U+200D`,
 * guion blando `U+00AD`, BOM `U+FEFF`…) y de control (`\p{Cc}`: `U+0000`,
 * `U+001B`, `U+007F`…), que no se ven y partirían una clave en dos
 * (`"pass\u200Bword"`, `"pass\u0000word"`).
 */
const INVISIBLES = /[\p{M}\p{Cf}\p{Cc}]/gu;

/** Separadores que no cuentan: `_`, `-` y cualquier espacio en blanco. El punto NO: `"api.key"` no es `"apikey"` (ver `redactarCambios`). */
const SEPARADORES = /[_\-\s]/g;

/**
 * La forma normalizada de una clave (o de un término de la lista), en este
 * orden:
 *
 * 1. Unicode `NFKD` y se quitan las marcas combinantes y los caracteres de
 *    formato y de control invisibles (`"contraseña"` → `"contrasena"`, `"ＰＡＳＳＷＯＲＤ"`
 *    de ancho completo → `"PASSWORD"`, `"pass\u200Bword"` → `"password"`);
 * 2. se saca el sufijo de colisión final (`"password (2)"` → `"password"`) —
 *    después del paso 1, así un sufijo con dígitos de ancho completo o con
 *    un carácter invisible pegado también se reconoce;
 * 3. minúsculas;
 * 4. se quitan `_`, `-` y los espacios (`"API-Key"`, `"api_key"`, `"api key"`
 *    y `"apiKey"` dan `"apikey"`).
 *
 * ```ts
 * normalizarClave("CONTRASEÑA (2)"); // "contrasena"
 * normalizarClave("x-api key");      // "xapikey"
 * ```
 */
export function normalizarClave(clave: string): string {
  return clave.normalize("NFKD").replace(INVISIBLES, "").replace(SUFIJO_DE_COLISION, "").toLowerCase().replace(SEPARADORES, "");
}

/**
 * `camposSensibles` normalizados con la MISMA `normalizarClave` (así un
 * término propio con acentos, `"código"`, funciona), en un `Set` para lookup
 * O(1). Un término que normaliza a `""` (`""`, `"_"`, `"-"`, `" (2)"`) se
 * DESCARTA: con la regla "termina con", `""` matchearía TODAS las claves.
 */
export function normalizarTerminos(camposSensibles: readonly string[]): Set<string> {
  const terminos = new Set<string>();
  for (const campo of camposSensibles) {
    const normalizado = normalizarClave(campo);
    if (normalizado !== "") terminos.add(normalizado);
  }
  return terminos;
}

/**
 * ¿`clave` es sensible? Es LA ÚNICA función que lo decide: la usan la rama
 * de objeto y la de `Map` de `redactar` y cada segmento de ruta de
 * `redactarCambios`, así las copias guardadas y `cambios` nunca discrepan
 * (antes cada una tenía su propia variante y una clave `"password (2)"`
 * adentro de una hoja del diff se filtraba). Sensible si su forma
 * normalizada (`normalizarClave`: NFKD sin acentos ni invisibles, sin
 * sufijo de colisión, minúsculas, sin `_`/`-`/espacios) IGUALA a algún término de
 * `terminosNormalizados` (que salen de `normalizarTerminos`), o TERMINA CON
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
 * Tapa de más a propósito: una clave literal que termine en `" (N)"` se
 * trata igual que una de colisión (`"password (2)"` se tapa), y cualquier
 * clave que termine en un término se tapa aunque no sea un secreto. Tapar
 * de más es el costo aceptado; tapar de menos, no.
 *
 * **Límite documentado**: esto es matching por NOMBRE DE CLAVE, no por
 * valor. Un secreto guardado bajo una clave NO sensible (ej. `notas: "la
 * contraseña temporal es Xy9$zK"`) no se detecta — `redactar`/`auditar` no
 * miran el contenido de los strings, ver el JSDoc de `redactar`.
 */
export function esClaveSensible(clave: string, terminosNormalizados: ReadonlySet<string>): boolean {
  return coincideNormalizada(normalizarClave(clave), terminosNormalizados);
}

/**
 * Cuántas veces se comparó un texto normalizado contra la lista de términos
 * desde el último `reiniciarContador()`. Interno (no se reexporta desde
 * `index.ts`): los tests lo usan para verificar la cota de `colaSensible`
 * de forma determinista, sin depender del reloj.
 */
let comparaciones = 0;
export function contarComparaciones(): number {
  return comparaciones;
}
export function reiniciarContador(): void {
  comparaciones = 0;
}

/** La regla "igual o termina con" sobre un texto YA normalizado. */
function coincideNormalizada(normalizada: string, terminosNormalizados: ReadonlySet<string>): boolean {
  comparaciones++;
  for (const termino of terminosNormalizados) {
    if (normalizada === termino || normalizada.endsWith(termino)) return true;
  }
  return false;
}

/**
 * La mayor cantidad de `"."` en un término normalizado (`0` si ninguno
 * tiene punto, como en `CAMPOS_SENSIBLES_POR_DEFECTO`). Se calcula UNA vez
 * por lista y acota `colaSensible`: un término con `d` puntos solo puede
 * coincidir con la cola de una ruta que abarque a lo sumo `d + 1`
 * segmentos (cada límite entre segmentos aporta un `"."`, y la
 * normalización puede AGREGAR puntos — `NFKD` de `"․"` da `"."` — pero
 * nunca los quita).
 */
export function puntosMaximos(terminosNormalizados: ReadonlySet<string>): number {
  let maximo = 0;
  for (const termino of terminosNormalizados) {
    let puntos = 0;
    for (const caracter of termino) if (caracter === ".") puntos++;
    if (puntos > maximo) maximo = puntos;
  }
  return maximo;
}

/**
 * ¿Alguna cola de `segmentosNormalizados` que TERMINA en
 * `segmentosNormalizados[fin]` es sensible? Cada segmento llega YA
 * normalizado (`normalizarClave`, uno por uno): así el sufijo de colisión de
 * un ancestro (`"cuenta (2)"` de un `Map`) se saca en CADA segmento, no solo
 * al final de la cola, y `"cuenta (2).numero"` matchea `"cuenta.numero"`.
 * Prueba el segmento solo y, si hay términos con punto (`maxPuntos > 0`),
 * las uniones con `"."` de los `k` segmentos que terminan en `fin`, con `k`
 * hasta `maxPuntos + 1`. Con `maxPuntos === 0` es una sola comparación: los
 * términos default no pagan nada extra. El costo por segmento está acotado
 * por el término más largo, no por la longitud de la ruta.
 */
export function colaSensible(segmentosNormalizados: readonly string[], fin: number, terminosNormalizados: ReadonlySet<string>, maxPuntos: number): boolean {
  if (coincideNormalizada(segmentosNormalizados[fin]!, terminosNormalizados)) return true;
  const inicioMinimo = Math.max(0, fin - maxPuntos);
  for (let inicio = fin - 1; inicio >= inicioMinimo; inicio--) {
    if (coincideNormalizada(segmentosNormalizados.slice(inicio, fin + 1).join("."), terminosNormalizados)) return true;
  }
  return false;
}
