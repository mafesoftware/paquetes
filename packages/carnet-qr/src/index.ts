/**
 * Carnet digital: una credencial firmada que se lee de un QR.
 *
 * ## Qué prueba el carnet y qué NO
 *
 * El carnet prueba **identidad**: que este QR lo emitió este club para este
 * socio y que todavía no venció. **No prueba que la cuota esté al día**, y no
 * puede: el estado de cuota cambia entre que se emite el carnet y que alguien
 * lo apoya en el molinete.
 *
 * Esa división es la que hace que el molinete funcione sin internet: el QR
 * dice *quién sos* y el dispositivo, con su copia sincronizada del padrón,
 * decide *si entrás*. Meter el estado de cuota adentro del token lo volvería
 * una foto vieja que abre la puerta a un moroso — el error clásico, porque
 * anda perfecto el día que se prueba.
 *
 * ## Por qué firma asimétrica y no HMAC
 *
 * Un molinete tiene que poder verificar **sin red**. Con HMAC, cualquier
 * dispositivo capaz de verificar es capaz de FIRMAR: alcanza con abrir un
 * lector de la entrada trasera para poder fabricarse carnets. Con Ed25519 el
 * club guarda la clave privada y los dispositivos solo llevan la pública, así
 * que un lector robado no sirve para falsificar nada.
 *
 * ## Revocación
 *
 * Un carnet no se borra: se le sube la **versión** al socio. Todo token con
 * una versión anterior a la vigente queda muerto, y el dispositivo lo sabe
 * porque la versión vigente viaja en el padrón que sincroniza. Es lo que se
 * usa cuando alguien pierde el teléfono.
 *
 * Sin dependencias fuera de `node:crypto`. No lee `process.env`.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as firmar,
  verify as verificarFirma,
  timingSafeEqual,
  type KeyObject,
} from "node:crypto";

/** Prefijo y versión del formato. Cambia si cambia la forma del token. */
const PREFIJO = "GF1";

/**
 * Separador de campos: el carácter "unit separator" (U+001F).
 *
 * No aparece en un nombre tipeado ni en un id, así que ningún dato puede
 * partir el payload en dos. Igual se limpia lo que entra: un separador
 * inyectado en un nombre correría todos los campos siguientes.
 */
const SEP = "\u001F";

export type DatosCarnet = {
  /** El club que lo emitió. */
  clubId: string;
  /** El socio, tal como lo identifica la base. */
  socioId: string;
  /** El número de socio que se muestra en la portería. */
  numeroSocio: string;
  /** Nombre para mostrar. Va adentro para que un molinete sin red pueda mostrarlo. */
  nombre: string;
  /** Categoría (activo, cadete, vitalicio…). Para mostrar, no para decidir. */
  categoria?: string;
  /** Versión del carnet. Subirla revoca todos los anteriores. */
  version: number;
  /** Cuándo se emitió. */
  emitidoEn: Date;
  /** Hasta cuándo vale. */
  valeHasta: Date;
};

export type ClavesCarnet = {
  /** PKCS#8 en PEM. La guarda el club; nunca sale al dispositivo. */
  privadaPem: string;
  /** SPKI en PEM. Va en cada dispositivo. */
  publicaPem: string;
};

/** Genera el par de claves de un club. Se hace UNA vez, al darlo de alta. */
export function generarClaves(): ClavesCarnet {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privadaPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicaPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/**
 * Emite un carnet. Devuelve el texto que va adentro del QR.
 *
 * El formato es `GF1.<datos>.<firma>`, con las dos partes en base64url.
 */
export function emitirCarnet(datos: DatosCarnet, privadaPem: string | KeyObject): string {
  const cuerpo = serializar(datos);
  const clave = typeof privadaPem === "string" ? createPrivateKey(privadaPem) : privadaPem;
  const firma = firmar(null, Buffer.from(cuerpo, "utf8"), clave);
  return `${PREFIJO}.${b64url(Buffer.from(cuerpo, "utf8"))}.${b64url(firma)}`;
}

/** Por qué un carnet no vale. */
export type MotivoInvalido =
  | "formato"
  | "firma"
  | "vencido"
  | "todavia_no_vale"
  | "version_revocada";

export type ResultadoCarnet =
  | { ok: true; datos: DatosCarnet }
  | { ok: false; motivo: MotivoInvalido; datos?: DatosCarnet };

/**
 * Verifica un carnet. **Nunca tira**: devuelve el motivo.
 *
 * Un lector escanea cualquier cosa —el QR de una gaseosa, un carnet de otro
 * club, un token cortado a la mitad—, así que la entrada es hostil por
 * definición y una excepción acá deja el molinete trabado.
 *
 * @param versionVigente Si se pasa, todo token con una versión menor se
 *   rechaza. Es la revocación, y sale del padrón que el dispositivo sincroniza.
 */
export function verificarCarnet(
  token: string,
  opciones: {
    publicaPem: string | KeyObject;
    ahora?: Date;
    versionVigente?: number;
    /** Segundos de tolerancia por relojes desfasados. 120 por defecto. */
    tolerancia?: number;
  }
): ResultadoCarnet {
  const { ahora = new Date(), versionVigente, tolerancia = 120 } = opciones;

  const partes = String(token ?? "").trim().split(".");
  if (partes.length !== 3 || partes[0] !== PREFIJO) return { ok: false, motivo: "formato" };

  let cuerpo: Buffer;
  let firma: Buffer;
  try {
    cuerpo = deB64url(partes[1]!);
    firma = deB64url(partes[2]!);
  } catch {
    return { ok: false, motivo: "formato" };
  }
  // Ed25519 firma siempre 64 bytes. Sin este corte, una firma de largo raro
  // llega a `verify` y algunas versiones de OpenSSL tiran en vez de devolver
  // false — justo lo que este `try` está para que no pase.
  if (firma.length !== 64 || cuerpo.length === 0) return { ok: false, motivo: "firma" };

  let clave: KeyObject;
  try {
    clave = typeof opciones.publicaPem === "string"
      ? createPublicKey(opciones.publicaPem)
      : opciones.publicaPem;
  } catch {
    return { ok: false, motivo: "firma" };
  }

  let firmaOk = false;
  try {
    firmaOk = verificarFirma(null, cuerpo, clave, firma);
  } catch {
    firmaOk = false;
  }
  // La firma se chequea ANTES de mirar el contenido: si no, el vencimiento de
  // un token inventado decide el mensaje de error y eso ya cuenta algo.
  if (!firmaOk) return { ok: false, motivo: "firma" };

  const datos = deserializar(cuerpo.toString("utf8"));
  if (!datos) return { ok: false, motivo: "formato" };

  const t = ahora.getTime();
  const margen = tolerancia * 1000;
  if (t > datos.valeHasta.getTime() + margen) return { ok: false, motivo: "vencido", datos };
  if (t < datos.emitidoEn.getTime() - margen) {
    return { ok: false, motivo: "todavia_no_vale", datos };
  }
  if (versionVigente !== undefined && datos.version < versionVigente) {
    return { ok: false, motivo: "version_revocada", datos };
  }

  return { ok: true, datos };
}

/**
 * Compara dos secretos sin filtrar por tiempo cuántos caracteres coinciden.
 *
 * Para los tokens de dispositivo, que sí son secretos compartidos.
 */
export function compararEnTiempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  // Comparar los largos primero filtra el largo, que no es el secreto.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/* ---------------------------------------------------------------- */

function serializar(d: DatosCarnet): string {
  // Un orden fijo y posicional: el token entra en un QR y cada byte cuenta.
  return [
    limpiar(d.clubId),
    limpiar(d.socioId),
    limpiar(d.numeroSocio),
    limpiar(d.nombre),
    limpiar(d.categoria ?? ""),
    String(d.version),
    String(Math.floor(d.emitidoEn.getTime() / 1000)),
    String(Math.floor(d.valeHasta.getTime() / 1000)),
  ].join(SEP);
}

function deserializar(s: string): DatosCarnet | null {
  const p = s.split(SEP);
  if (p.length !== 8) return null;
  const version = Number(p[5]);
  const emitido = Number(p[6]);
  const vale = Number(p[7]);
  if (!Number.isInteger(version) || !Number.isFinite(emitido) || !Number.isFinite(vale)) {
    return null;
  }
  return {
    clubId: p[0]!,
    socioId: p[1]!,
    numeroSocio: p[2]!,
    nombre: p[3]!,
    categoria: p[4] || undefined,
    version,
    emitidoEn: new Date(emitido * 1000),
    valeHasta: new Date(vale * 1000),
  };
}

/**
 * Saca del texto lo que podría partir el payload.
 *
 * Un separador inyectado adentro de un nombre correría todos los campos
 * siguientes: el `numeroSocio` de uno pasaría a leerse como la `categoria` de
 * otro. La firma haría que el token siga siendo válido, porque lo firmó el
 * club — el ataque no es falsificar, es lograr que el club firme algo torcido.
 */
function limpiar(s: string): string {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\u0000-\u001F\u007F]/g, " ").trim();
}

function b64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function deB64url(s: string): Buffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}
