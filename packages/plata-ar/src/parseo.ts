import { redondearComercial } from "./bigint.js";

/**
 * Resultado de `parsearImporte`: nunca tira. Un texto mal escrito por una
 * persona es un dato inválido, no un bug de quien llama (a diferencia de los
 * `ErrorPlata` de `reparto.ts`/`factor.ts`/`moneda.ts`, ver `errores.ts`).
 */
export type ResultadoParseoImporte = { ok: true; centavos: bigint } | { ok: false; error: string };

export interface OpcionesParseoImporte {
  /** Si es `false`, un importe negativo se reporta como error. `true` por defecto. */
  permitirNegativo?: boolean;
  /**
   * Si es `true`, interpreta un único punto como separador **decimal**
   * (convención en inglés: `"44000.5"` → 4.400.050 centavos). Sin esta
   * opción (default `false`), un punto es **siempre** separador de miles
   * (spec 02 §1) y tiene que agrupar de a 3 dígitos exactos — con esta
   * opción activa, la coma deja de aceptarse.
   */
  decimalConPunto?: boolean;
}

interface ImporteAnalizado {
  negativo: boolean;
  entero: string;
  decimales: string;
}

/** `true` si `texto` es un entero simple o un agrupamiento de miles válido ("1", "44.000", "1.234.000"). */
function esGrupoDeMilesValido(texto: string): boolean {
  return /^\d+$/.test(texto) || /^\d{1,3}(?:\.\d{3})+$/.test(texto);
}

/**
 * Símbolos y códigos de moneda que `parsearImporte` tolera delante o
 * detrás del número. Cualquier OTRO caracter que no sea dígito, `.`, `,`,
 * un `-` inicial o espacio es un importe inválido — no se descarta en
 * silencio (a diferencia de una limpieza a ciegas tipo `[^\d.,-]`, que
 * convertiría `"1e3"` en `"13"` o `"(500)"` en `"500"`).
 */
const TOKENS_MONEDA = /(US\$|U\$S|ARS|USD|EUR|\$|€)/gi;

/** Quita símbolos/códigos de moneda y espacios; `null` si queda algo que no es dígito, `.`, `,` o un `-` inicial. */
function limpiarImporte(textoOriginal: string): string | null {
  const texto = String(textoOriginal ?? "");
  if (!texto.trim()) return null;

  const sinSimbolos = texto.replace(TOKENS_MONEDA, "");
  const compacto = sinSimbolos.replace(/\s+/g, "");
  if (!compacto) return null;
  if (!/^-?[\d.,]+$/.test(compacto)) return null;

  return compacto;
}

/**
 * Formato argentino **estricto** (spec 02 §1): si hay coma, la coma es el
 * decimal y los puntos son miles — validados como agrupamiento real, así
 * que `"1.2.3,4"` (miles mal agrupados) es inválido en vez de leerse como
 * `123,4`. Sin coma, un punto es **siempre** separador de miles y tiene que
 * agrupar de a 3 dígitos exactos: `"44.000"` es válido, `"1.50"` y
 * `"1234.56"` NO lo son (para esos hace falta `decimalConPunto: true`, la
 * convención en inglés).
 */
function analizarImporte(textoOriginal: string, decimalConPunto: boolean): ImporteAnalizado | null {
  const limpio = limpiarImporte(textoOriginal);
  if (limpio === null) return null;

  let resto = limpio;
  let negativo = false;
  if (resto.startsWith("-")) {
    negativo = true;
    resto = resto.slice(1);
  }
  // `resto` nunca es "" acá: `limpiarImporte` exige `[\d.,]+` (1+
  // caracteres) después de un "-" inicial opcional, así que un texto que
  // era solo "-" ya volvió `null` más arriba.

  if (decimalConPunto) {
    if (resto.includes(",")) return null; // el modo inglés no admite coma
    const coincidencia = /^(\d+)(?:\.(\d+))?$/.exec(resto);
    if (!coincidencia) return null;
    return { negativo, entero: coincidencia[1]!, decimales: coincidencia[2] ?? "" };
  }

  const cantidadComas = (resto.match(/,/g) ?? []).length;
  if (cantidadComas > 1) return null;

  if (cantidadComas === 1) {
    const [enteroCrudo = "", decimales = ""] = resto.split(",");
    if (!/^\d+$/.test(decimales)) return null;
    if (!esGrupoDeMilesValido(enteroCrudo)) return null;
    return { negativo, entero: enteroCrudo.replace(/\./g, ""), decimales };
  }

  // Sin coma: el/los punto(s) SIEMPRE son separador de miles y tienen que
  // agrupar de a 3 dígitos exactos.
  if (!esGrupoDeMilesValido(resto)) return null;
  return { negativo, entero: resto.replace(/\./g, ""), decimales: "" };
}

/**
 * Lo que alguien tipeó, en centavos exactos (`bigint`). Nunca tira: un texto
 * inválido vuelve como `{ ok: false, error }`.
 *
 * Reemplaza a `parsearPlata` de la 0.1 (que sigue existiendo, para no romper
 * a quien ya la usa, devolviendo `Centavos | null`) bajo otro nombre porque
 * la forma del resultado cambió de raíz: acá no hay `null` posible, hay un
 * `error` legible.
 *
 * @example
 * parsearImporte("44.000");      // { ok: true, centavos: 4_400_000n }
 * @example
 * parsearImporte("44.000,50");   // { ok: true, centavos: 4_400_050n }
 * @example
 * parsearImporte("1,234");       // { ok: true, centavos: 123n }  (coma = decimal, en es-AR)
 * @example
 * parsearImporte("1.2.3,4");     // { ok: false, error: "..." }  (miles mal agrupados)
 * @example
 * parsearImporte("1234.56");     // { ok: false, error: "..." }  (un punto SIEMPRE es miles acá)
 * parsearImporte("1234.56", { decimalConPunto: true }); // { ok: true, centavos: 123_456n }
 */
export function parsearImporte(texto: string, opciones: OpcionesParseoImporte = {}): ResultadoParseoImporte {
  const { permitirNegativo = true, decimalConPunto = false } = opciones;
  const analizado = analizarImporte(texto, decimalConPunto);
  if (!analizado) {
    return { ok: false, error: `"${String(texto)}" no es un importe válido.` };
  }
  if (analizado.negativo && !permitirNegativo) {
    return { ok: false, error: `"${String(texto)}" es negativo y este campo no acepta negativos.` };
  }

  // `analizado.entero` nunca es "": `esGrupoDeMilesValido` (y, en modo
  // `decimalConPunto`, el propio regex) rechazan un grupo entero vacío
  // antes de que `analizarImporte` pueda devolverlo.
  const enteroBig = BigInt(analizado.entero);
  let centavos = enteroBig * 100n;
  if (analizado.decimales.length > 0) {
    const decimalesBig = BigInt(analizado.decimales);
    const den = 10n ** BigInt(analizado.decimales.length);
    // Los decimales tipeados son fracción de PESO; ×100 los pasa a centavos
    // antes de redondear (p.ej. ",234" → 23,4 centavos → 23 centavos).
    centavos += redondearComercial(decimalesBig * 100n, den);
  }
  if (analizado.negativo) centavos = -centavos;

  return { ok: true, centavos };
}
