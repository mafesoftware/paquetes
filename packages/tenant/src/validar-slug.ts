import { RESERVADOS } from "./reservados.js";

/** Por qué un slug propuesto (para crear una organización, o leído de un host) no vale. */
export type MotivoSlugInvalido =
  | "longitud" // menos de 3 o más de 40 caracteres
  | "caracteres_invalidos" // algo fuera de [a-z0-9-] (mayúsculas, espacios, símbolos)
  | "guion_borde" // empieza o termina con "-"
  | "guion_doble" // "--" en cualquier posición
  | "reservado" // coincide con un nombre reservado (case-insensitive)
  | "no_ascii"; // tiene algún carácter fuera de ASCII (acentos, eñes, emojis...)

export type ResultadoValidarSlug =
  | { ok: true; slug: string }
  | { ok: false; motivo: MotivoSlugInvalido; sugerencia?: string };

/**
 * ¿`s` sirve como slug de organización? Puro: no consulta si ya existe, solo
 * si tiene la FORMA correcta — eso es responsabilidad de quien llama (un
 * slug con forma válida puede seguir estando tomado).
 *
 * Reglas (spec 06 §3 / decisiones de la tarea): 3 a 40 caracteres,
 * `[a-z0-9-]`, sin guion al principio o al final, sin `--`, no reservado
 * (comparación sin distinguir mayúsculas: `"Admin"` cuenta como reservado
 * aunque el patrón de caracteres solo acepte minúsculas), solo ASCII.
 *
 * El orden de los chequeos importa para el `motivo` que se devuelve cuando
 * hay más de un problema a la vez: reservado gana primero (es la razón más
 * específica y accionable — decirle a alguien "está reservado" es más útil
 * que "tiene mayúsculas"), después ASCII, longitud, el patrón de
 * caracteres y por último los guiones de borde/dobles.
 *
 * `sugerencia` es un candidato normalizado (minúsculas, sin acentos,
 * separadores colapsados a un solo "-") cuando existe uno razonable: nunca
 * para `motivo: "reservado"` (no hay forma de "arreglar" un nombre
 * reservado sin inventar uno distinto) ni cuando el candidato normalizado
 * queda demasiado corto o sigue siendo un reservado.
 */
export function validarSlug(s: string, reservados: ReadonlySet<string> = RESERVADOS): ResultadoValidarSlug {
  if (reservados.has(s.toLowerCase())) {
    return { ok: false, motivo: "reservado" };
  }

  const sugerencia = candidatoNormalizado(s, reservados);
  const invalido = (motivo: MotivoSlugInvalido): ResultadoValidarSlug =>
    sugerencia !== undefined ? { ok: false, motivo, sugerencia } : { ok: false, motivo };

  if (/[^\x00-\x7F]/.test(s)) return invalido("no_ascii");
  if (s.length < 3 || s.length > 40) return invalido("longitud");
  if (!/^[a-z0-9-]+$/.test(s)) return invalido("caracteres_invalidos");
  if (s.startsWith("-") || s.endsWith("-")) return invalido("guion_borde");
  if (s.includes("--")) return invalido("guion_doble");

  return { ok: true, slug: s };
}

/**
 * Un candidato normalizado a partir de cualquier texto ("Mi Constructora" →
 * `"mi-constructora"`, "Construcción" → `"construccion"`), o `undefined`
 * cuando no hay uno razonable (queda vacío, muy corto, o el resultado es un
 * reservado).
 */
function candidatoNormalizado(s: string, reservados: ReadonlySet<string>): string | undefined {
  let c = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita los acentos (diacríticos NFD)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // cualquier corrida de caracteres no permitidos -> un solo "-"
    .replace(/^-+|-+$/g, ""); // sin guion al principio/final

  if (c.length > 40) {
    c = c.slice(0, 40).replace(/-+$/g, "");
  }

  if (c.length < 3 || reservados.has(c)) {
    return undefined;
  }

  return c;
}
