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
 * ## Nunca tira
 *
 * Un pase lo manda cualquiera con un link, así que la entrada es hostil por
 * definición (a diferencia de `cifrar`/`descifrar`, que reciben datos
 * propios). `verificarPase` siempre devuelve `{ ok, ... }`.
 */

import { createHmac } from "node:crypto";
import { compararEnTiempoConstante } from "./comparar.js";

/** Lo que se firma. `venceEn` acepta un `Date` o milisegundos desde epoch. */
export type DatosPase = {
  /** Para qué es el pase ("reset-password", "invitacion", "magic-link", ...). Evita que un pase de un uso sirva para otro. */
  proposito: string;
  /** De quién es: un id de usuario, un email — lo que la app necesite para actuar. */
  sujeto: string;
  /** Cuándo deja de valer. */
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
  /** El token no tiene la forma `<payload>.<firma>`. */
  | "formato"
  /** La firma no coincide: no lo firmamos nosotros, o el payload fue alterado. */
  | "firma"
  /** `venceEn` ya pasó. */
  | "vencido"
  /** Se pidió verificar con un `proposito` distinto al que se firmó. */
  | "proposito"
  /** El sello del pase no coincide con `selloActual`: el estado que sella cambió. */
  | "sello";

export type ResultadoPase = { ok: true; sujeto: string } | { ok: false; motivo: MotivoPaseInvalido };

function firmar(payload: string, secreto: string): string {
  return createHmac("sha256", secreto).update(payload).digest("base64url");
}

function comoMs(fecha: Date | number): number {
  return fecha instanceof Date ? fecha.getTime() : fecha;
}

/** Firma un pase. Formato compacto: `<payload base64url>.<firma HMAC-SHA256 base64url>`. */
export function crearPase(pase: DatosPase, secreto: string): string {
  const cuerpo: CuerpoPase = {
    p: pase.proposito,
    s: pase.sujeto,
    v: comoMs(pase.venceEn),
    h: pase.sello,
  };
  const payload = Buffer.from(JSON.stringify(cuerpo), "utf8").toString("base64url");
  return `${payload}.${firmar(payload, secreto)}`;
}

/**
 * Verifica un pase. **Nunca tira**: devuelve el motivo.
 *
 * El orden de los chequeos importa poco para la seguridad (la firma se
 * verifica antes que cualquier otra cosa, así que nada del contenido decide
 * el resultado si el token no es nuestro) pero sí para el diagnóstico: un
 * pase ajeno da `"firma"` antes que `"vencido"` o `"proposito"`.
 */
export function verificarPase(
  token: string,
  secreto: string,
  opciones: { proposito: string; selloActual: string; ahora?: Date | number },
): ResultadoPase {
  const partes = String(token ?? "").split(".");
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

  const ahora = opciones.ahora === undefined ? Date.now() : comoMs(opciones.ahora);
  if (ahora > cuerpo.v) return { ok: false, motivo: "vencido" };
  if (cuerpo.p !== opciones.proposito) return { ok: false, motivo: "proposito" };
  if (!compararEnTiempoConstante(cuerpo.h, opciones.selloActual)) return { ok: false, motivo: "sello" };

  return { ok: true, sujeto: cuerpo.s };
}
