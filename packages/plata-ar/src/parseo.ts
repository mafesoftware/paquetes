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
 * Formato argentino (spec 02 §1, misma regla que `parsearNumeroAR` de la
 * 0.1): si hay coma, la coma es el decimal y los puntos son miles —
 * validados como agrupamiento real, no descartados a ciegas, así que
 * `"1.2.3,4"` (miles mal agrupados) es inválido en vez de leerse como
 * `123,4`. Sin coma, un único punto con 3 dígitos después es miles
 * (`"44.000"`); con 1 o 2 dígitos es decimal (`"10.5"`, planilla en inglés).
 */
function analizarImporte(textoOriginal: string): ImporteAnalizado | null {
  const limpio = String(textoOriginal ?? "")
    .replace(/[^\d.,-]/g, "")
    .trim();
  if (!limpio) return null;

  let resto = limpio;
  let negativo = false;
  if (resto.startsWith("-")) {
    negativo = true;
    resto = resto.slice(1);
  }
  if (!resto || resto.includes("-")) return null;

  const cantidadComas = (resto.match(/,/g) ?? []).length;
  if (cantidadComas > 1) return null;

  if (cantidadComas === 1) {
    const [enteroCrudo = "", decimales = ""] = resto.split(",");
    if (!/^\d+$/.test(decimales)) return null;
    if (!esGrupoDeMilesValido(enteroCrudo)) return null;
    return { negativo, entero: enteroCrudo.replace(/\./g, ""), decimales };
  }

  const cantidadPuntos = (resto.match(/\./g) ?? []).length;
  if (cantidadPuntos === 0) {
    // Sin coma, sin punto y sin "-" (ya se sacó arriba): lo que queda de la
    // limpieza inicial (`[^\d.,-]`) solo puede ser dígitos.
    return { negativo, entero: resto, decimales: "" };
  }
  if (cantidadPuntos === 1) {
    const [antes = "", despues = ""] = resto.split(".");
    if (!/^\d+$/.test(antes) || !/^\d+$/.test(despues) || despues.length === 0) return null;
    if (despues.length === 3) {
      return { negativo, entero: antes + despues, decimales: "" };
    }
    return { negativo, entero: antes, decimales: despues };
  }

  // Dos o más puntos: solo válido como agrupamiento de miles completo.
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
 */
export function parsearImporte(texto: string, opciones: OpcionesParseoImporte = {}): ResultadoParseoImporte {
  const { permitirNegativo = true } = opciones;
  const analizado = analizarImporte(texto);
  if (!analizado) {
    return { ok: false, error: `"${String(texto)}" no es un importe válido.` };
  }
  if (analizado.negativo && !permitirNegativo) {
    return { ok: false, error: `"${String(texto)}" es negativo y este campo no acepta negativos.` };
  }

  // `analizado.entero` nunca es "": `esGrupoDeMilesValido` rechaza un grupo
  // entero vacío antes de que `analizarImporte` pueda devolverlo.
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
