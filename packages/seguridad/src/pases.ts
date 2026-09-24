/**
 * Pases firmados y con vencimiento: reset de contraseña, invitaciones, magic
 * links. Todo lo que store360 (`paseRecupero.ts`), consult360, facturar y
 * distrigo reimplementaban cada uno a su manera con HMAC + JSON en base64url.
 *
 * ## Por qué no hay tabla de tokens
 *
 * Un pase FIRMADO no necesita fila propia: nadie puede fabricarlo sin el
 * secreto, vence solo, y no hay nada que crear, limpiar ni migrar. Guardar
 * los tokens en una tabla suma una migración y un barrido de filas viejas
 * para comprar una sola cosa que casi nunca hace falta: revocar un link
 * puntual antes de que se use.
 *
 * ## El `sello`: de un solo uso sin guardar nada
 *
 * `sello` es un string opaco que la APP deriva — típicamente un resumen del
 * `passwordHash` de ese momento — y que viaja adentro del pase. Al verificar,
 * se compara contra `selloActual`, que la app calcula de nuevo a partir del
 * estado ACTUAL (por eso hay que leerlo de la base antes de llamar acá: el
 * chequeo no se puede hacer del lado del cliente). Si cambian —la contraseña
 * se cambió, la invitación se usó— el pase muere, aunque no haya vencido.
 * Es más fuerte que un `usado_en`, que solo mata el pase que se usó.
 *
 * El paquete no sabe CÓMO se deriva el sello (no lee ni un `passwordHash`):
 * solo lo compara en tiempo constante, como la firma.
 *
 * ## Nunca tira con datos de USUARIO — pero sí con datos de CONFIGURACIÓN
 *
 * Un pase lo manda cualquiera con un link, así que el `token` es hostil por
 * definición (a diferencia de `cifrar`/`descifrar`, que reciben datos
 * propios): `verificarPase` nunca tira por un `token` raro. Pero `secreto` y
 * `opciones.ahora` los pasa la APP, no quien ataca — si `secreto` está vacío,
 * es demasiado corto, o `ahora` es una fecha inválida (`NaN`), eso es un bug
 * de configuración, no una entrada de usuario. Fix round 1 (C2/I4): en vez de
 * tirar un `TypeError` crudo desde `node:crypto` (con `secreto` `undefined`)
 * o revivir un pase vencido (con `ahora` `NaN`, donde `NaN > cualquier_cosa`
 * siempre da `false`), `verificarPase` sigue sin tirar — devuelve
 * `{ ok: false, motivo: "configuracion" }`, un resultado que un caller
 * descuidado trata igual que cualquier otro pase inválido (rechazado), nunca
 * como válido. `crearPase`, en cambio, SÍ tira (`ErrorSeguridad`) con
 * `secreto`/`venceEn` inválidos: ahí quien llama es código propio, y un
 * secreto de 3 caracteres o un `venceEn` que es `NaN` es un bug que conviene
 * que explote temprano, no un pase silenciosamente irrecuperable.
 *
 * ## Vence en el instante exacto, no un instante después
 *
 * Un pase es válido en el instante EXACTO de `venceEn` (`ahora === venceEn`
 * todavía sirve) e inválido en cualquier instante posterior
 * (`ahora > venceEn` → `"vencido"`). Es una elección arbitraria pero
 * documentada: lo importante es que el código, este comentario y los tests
 * (`tests/pases.test.ts`) digan lo mismo.
 */

import { createHmac } from "node:crypto";
import { compararEnTiempoConstante } from "./comparar.js";
import { ErrorSeguridad } from "./errores.js";

/**
 * Mínimo de caracteres para el secreto de firma HMAC. Menos que esto es
 * forzable por fuerza bruta en un tiempo razonable — 32 caracteres al azar
 * (256 bits si vienen de un alfabeto amplio) es el mismo piso que la clave de
 * `cifrar`/`descifrar`. Generalo con `openssl rand -base64 32`.
 */
const SECRETO_MIN_LARGO = 32;

/**
 * Largo máximo de un token a verificar. Un pase real (JSON compacto en
 * base64url + firma HMAC-SHA256 en base64url) nunca se acerca a esto; un
 * token más largo no tiene por qué parsearse — es, en el mejor de los casos,
 * un error de quien lo generó, y en el peor una entrada pensada para hacer
 * trabajar de más a `JSON.parse`/`Buffer.from`.
 */
const MAX_TOKEN_LARGO = 4096;

function secretoValido(secreto: unknown): secreto is string {
  return typeof secreto === "string" && secreto.length >= SECRETO_MIN_LARGO;
}

/** Lo que se firma. `venceEn` acepta un `Date` o milisegundos desde epoch. */
export type DatosPase = {
  /** Para qué es el pase ("reset-password", "invitacion", "magic-link", ...). Evita que un pase de un uso sirva para otro. */
  proposito: string;
  /** De quién es: un id de usuario, un email — lo que la app necesite para actuar. */
  sujeto: string;
  /** Cuándo deja de valer. Válido en este instante exacto, inválido después. */
  venceEn: Date | number;
  /** El sello opaco que la app deriva del estado que, al cambiar, tiene que matar el pase. */
  sello: string;
};

type CuerpoPase = {
  p: string;
  s: string;
  v: number;
  h: string;
};

export type MotivoPaseInvalido =
  /** El token no tiene la forma `<payload>.<firma>`, o supera `MAX_TOKEN_LARGO` (4096 caracteres). */
  | "formato"
  /** La firma no coincide: no lo firmamos nosotros, o el payload fue alterado. */
  | "firma"
  /** `venceEn` ya pasó (estrictamente: `ahora > venceEn`). */
  | "vencido"
  /** Se pidió verificar con un `proposito` distinto al que se firmó. */
  | "proposito"
  /** El sello del pase no coincide con `selloActual`: el estado que sella cambió. */
  | "sello"
  /** `secreto` no es un string de al menos 32 caracteres, o `ahora` no es una fecha/epoch finita: un bug de quien llama, no del token. */
  | "configuracion";

export type ResultadoPase = { ok: true; sujeto: string } | { ok: false; motivo: MotivoPaseInvalido };

function firmar(payload: string, secreto: string): string {
  return createHmac("sha256", secreto).update(payload).digest("base64url");
}

function comoMs(fecha: Date | number): number {
  return fecha instanceof Date ? fecha.getTime() : fecha;
}

/**
 * Firma un pase. Formato compacto: `<payload base64url>.<firma HMAC-SHA256 base64url>`.
 *
 * Tira `ErrorSeguridad`:
 * - `"secreto_invalido"`: `secreto` no es un string de al menos 32 caracteres.
 * - `"pase_invalido"`: `venceEn` no es una fecha/epoch finita (`NaN`, `Invalid Date`, `Infinity`).
 */
export function crearPase(pase: DatosPase, secreto: string): string {
  if (!secretoValido(secreto)) {
    throw new ErrorSeguridad(
      "secreto_invalido",
      `El secreto de firma tiene que ser un string de al menos ${SECRETO_MIN_LARGO} caracteres (es la clave HMAC: uno corto se puede forzar por fuerza bruta). Generalo con "openssl rand -base64 32".`,
    );
  }
  const venceEn = comoMs(pase.venceEn);
  if (!Number.isFinite(venceEn)) {
    throw new ErrorSeguridad("pase_invalido", `venceEn no es una fecha/epoch válida: ${String(pase.venceEn)}.`);
  }

  const cuerpo: CuerpoPase = {
    p: pase.proposito,
    s: pase.sujeto,
    v: venceEn,
    h: pase.sello,
  };
  const payload = Buffer.from(JSON.stringify(cuerpo), "utf8").toString("base64url");
  return `${payload}.${firmar(payload, secreto)}`;
}

/**
 * Verifica un pase. **Nunca tira**, ni con un `token` hostil ni con un
 * `secreto`/`ahora` mal configurados — ver la cabecera del archivo.
 *
 * El orden de los chequeos importa poco para la seguridad (la firma se
 * verifica antes que cualquier otra cosa del CONTENIDO, así que nada del
 * payload decide el resultado si el token no es nuestro) pero sí para el
 * diagnóstico: un pase ajeno da `"firma"` antes que `"vencido"` o
 * `"proposito"`. `"configuracion"` va primero de todos: si `secreto`/`ahora`
 * están mal, ni vale la pena mirar el token.
 */
export function verificarPase(
  token: string,
  secreto: string,
  opciones: { proposito: string; selloActual: string; ahora?: Date | number },
): ResultadoPase {
  if (!secretoValido(secreto)) return { ok: false, motivo: "configuracion" };

  const ahora = opciones.ahora === undefined ? Date.now() : comoMs(opciones.ahora);
  if (!Number.isFinite(ahora)) return { ok: false, motivo: "configuracion" };

  const tokenTexto = typeof token === "string" ? token : String(token ?? "");
  if (tokenTexto.length === 0 || tokenTexto.length > MAX_TOKEN_LARGO) return { ok: false, motivo: "formato" };

  const partes = tokenTexto.split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return { ok: false, motivo: "formato" };
  const [payload, firma] = partes as [string, string];

  if (!compararEnTiempoConstante(firma, firmar(payload, secreto))) {
    return { ok: false, motivo: "firma" };
  }

  let crudo: unknown;
  try {
    crudo = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, motivo: "formato" };
  }
  // `JSON.parse` no tira con `"null"`, `"42"` o `"[]"` — válidos como JSON,
  // inválidos como cuerpo del pase. El chequeo de tipo de acá abajo es lo que
  // evita acceder a una propiedad de `null`.
  if (typeof crudo !== "object" || crudo === null) return { ok: false, motivo: "formato" };
  const cuerpo = crudo as CuerpoPase;
  if (
    typeof cuerpo.p !== "string" ||
    typeof cuerpo.s !== "string" ||
    typeof cuerpo.v !== "number" ||
    !Number.isFinite(cuerpo.v) ||
    typeof cuerpo.h !== "string"
  ) {
    return { ok: false, motivo: "formato" };
  }

  // Válido en el instante EXACTO de venceEn, inválido después (ver cabecera).
  if (ahora > cuerpo.v) return { ok: false, motivo: "vencido" };
  if (cuerpo.p !== opciones.proposito) return { ok: false, motivo: "proposito" };
  if (!compararEnTiempoConstante(cuerpo.h, opciones.selloActual)) return { ok: false, motivo: "sello" };

  return { ok: true, sujeto: cuerpo.s };
}
