/**
 * Separa signo, token de moneda y cuerpo numérico de un texto, con un
 * escáner de una sola pasada (índice que solo avanza) — nunca con una
 * regex que deje `\s*` opcionales pegados unos a otros, que en V8/JSC
 * puede backtrackear de forma cuadrática sobre una corrida larga de
 * espacios (medido: `" ".repeat(n) + "x"` con una regex así tarda ~30ms
 * con n=5.000 y ~1,8s con n=40.000; con este escáner, lineal, cualquier
 * largo de espacios se recorre en un solo paso).
 *
 * Interno: NO se re-exporta desde `index.ts` (mismo criterio que
 * `escala-factor.ts` para `factorAEscala`/`ESCALA_FACTOR`) — es un detalle
 * de implementación de `parsearImporte` (que además cubre entradas largas
 * con un tope de longitud, ver `parseo.ts`), no algo que un consumidor del
 * paquete necesite llamar directo. Se exporta desde este módulo separado
 * para poder testear su linealidad de forma aislada, sin pasar por el tope
 * de longitud de `parsearImporte`.
 */

/** Símbolos y códigos de moneda tolerados, como mucho UNO en total (prefijo o sufijo, nunca los dos). */
const TOKENS_MONEDA = ["US$", "U$S", "ARS", "USD", "EUR", "$", "€"];

function esEspacio(caracter: string): boolean {
  return caracter === " " || caracter === "\t" || caracter === "\n" || caracter === "\r" || /\s/.test(caracter);
}

function esCaracterDeCuerpo(caracter: string): boolean {
  return (caracter >= "0" && caracter <= "9") || caracter === "." || caracter === ",";
}

function saltarEspacios(texto: string, indice: number): number {
  let i = indice;
  while (i < texto.length && esEspacio(texto[i]!)) i++;
  return i;
}

/** Si un token de moneda empieza en `indice`, su longitud; si no, `0`. Comparación case-insensitive. */
function longitudDeTokenEnPosicion(texto: string, indice: number): number {
  for (const token of TOKENS_MONEDA) {
    if (texto.length - indice < token.length) continue;
    if (texto.slice(indice, indice + token.length).toUpperCase() === token.toUpperCase()) {
      return token.length;
    }
  }
  return 0;
}

export interface ImporteEscaneado {
  negativo: boolean;
  nucleo: string;
}

/**
 * Escanea `texto` en O(n), una sola pasada: signo (`-`) y token de moneda
 * pueden aparecer, en cualquier orden entre sí, como PREFIJO (con espacios
 * sueltos entre ellos y antes del cuerpo); un token puede aparecer en
 * cambio como SUFIJO. Como mucho UN signo y como mucho UN token en total
 * (nunca dos tokens, ni prefijo y sufijo a la vez — `"$$5"`, `"ARS5USD"`
 * son inválidos). El cuerpo (dígitos, `.`, `,`) tiene que ser contiguo, sin
 * espacios ni tokens adentro.
 *
 * `null` si el texto no matchea esa forma (o si no queda nada después del
 * prefijo/sufijo que sea un cuerpo numérico).
 */
export function escanearImporte(texto: string): ImporteEscaneado | null {
  const n = texto.length;
  let i = saltarEspacios(texto, 0);

  let negativo = false;
  let tokenUsado = false;

  // Prefijo: como mucho un signo y como mucho un token, en cualquier
  // orden, separados por espacios sueltos. Dos iteraciones alcanzan para
  // cubrir las dos combinaciones posibles (signo-token o token-signo).
  for (let intento = 0; intento < 2; intento++) {
    if (!negativo && texto[i] === "-") {
      negativo = true;
      i = saltarEspacios(texto, i + 1);
      continue;
    }
    if (!tokenUsado) {
      const longitud = longitudDeTokenEnPosicion(texto, i);
      if (longitud > 0) {
        tokenUsado = true;
        i = saltarEspacios(texto, i + longitud);
        continue;
      }
    }
    break;
  }

  const inicioCuerpo = i;
  while (i < n && esCaracterDeCuerpo(texto[i]!)) i++;
  if (i === inicioCuerpo) return null; // sin cuerpo numérico
  const nucleo = texto.slice(inicioCuerpo, i);

  i = saltarEspacios(texto, i);

  // Sufijo: un token, solo si no se usó ya uno en el prefijo.
  if (!tokenUsado && i < n) {
    const longitud = longitudDeTokenEnPosicion(texto, i);
    if (longitud > 0) {
      tokenUsado = true;
      i = saltarEspacios(texto, i + longitud);
    }
  }

  if (i !== n) return null; // sobró algo sin consumir

  return { negativo, nucleo };
}
