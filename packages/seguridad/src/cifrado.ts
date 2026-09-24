/**
 * Cifrado simétrico versionado para secretos que hay que poder leer de
 * vuelta: certificados fiscales, tokens de OAuth de terceros, cualquier cosa
 * que viaje en un backup o en un dump de soporte y no pueda quedar en claro.
 *
 * ## El formato es compatible con `fiscalCifrado.ts` de store360
 *
 * `v1:<iv>:<tag>:<datos>`, los tres segmentos en base64 estándar (no
 * base64url), AES-256-GCM con IV de 12 bytes — carácter por carácter lo que
 * store360 ya tenía guardado en producción. Migrar significa pasarle a este
 * paquete la misma clave de 32 bytes que store360 leía de
 * `FISCAL_CIFRADO_CLAVE` (como string base64 o ya decodificada): lo que hoy
 * está guardado se sigue leyendo sin volver a cifrar nada. La versión
 * adelante (`v1`) es lo que permitiría, el día de mañana, cambiar el esquema
 * sin tener que adivinar qué hay en cada fila.
 *
 * ## Por qué la clave es un parámetro y no una variable de entorno
 *
 * Un núcleo puro no lee el entorno (ver restricciones.md): quien llama
 * decide de dónde sale la clave — de una variable de entorno, de un secret
 * manager, de lo que sea. Acepta un string en base64 (para pegar directo lo
 * que devuelve `openssl rand -base64 32`, o lo que ya vive en una variable
 * de entorno) o un `Uint8Array` ya decodificado.
 *
 * ## Por qué tira en vez de devolver un resultado
 *
 * `descifrar` de un texto alterado, con un prefijo desconocido o cifrado con
 * otra clave es un error de programación o un dato corrupto — no una entrada
 * de usuario a validar (a diferencia de `verificarPase`, que sí puede recibir
 * un token cualquiera de la red). `ErrorSeguridad` con su `codigo` deja que
 * quien llama distinga "la clave está mal configurada" de "esto no es lo que
 * yo cifré", sin tener que parsear el mensaje.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ErrorSeguridad } from "./errores.js";

const VERSION = "v1";
/** AES-256: 32 bytes de clave. */
const LARGO_CLAVE = 32;
/** El largo de IV recomendado para GCM (NIST SP 800-38D): 96 bits. */
const LARGO_IV = 12;

/** Una clave de 32 bytes: en base64 (como la devuelve `openssl rand -base64 32`) o ya decodificada. */
export type Clave = string | Uint8Array;

function claveBuffer(clave: Clave): Buffer {
  const buffer = typeof clave === "string" ? Buffer.from(clave, "base64") : Buffer.from(clave);
  if (buffer.length !== LARGO_CLAVE) {
    throw new ErrorSeguridad(
      "clave_invalida",
      `La clave tiene que ser de ${LARGO_CLAVE} bytes (AES-256); recibió ${buffer.length}. Si es un string, tiene que estar en base64 (generala con "openssl rand -base64 32").`,
    );
  }
  return buffer;
}

/** Cifra `textoPlano` con AES-256-GCM. Devuelve `"v1:<iv>:<tag>:<datos>"`, todo en base64. */
export function cifrar(textoPlano: string, clave: Clave): string {
  const claveBytes = claveBuffer(clave);
  const iv = randomBytes(LARGO_IV);
  const cifrador = createCipheriv("aes-256-gcm", claveBytes, iv);
  const datos = Buffer.concat([cifrador.update(textoPlano, "utf8"), cifrador.final()]);
  const tag = cifrador.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), datos.toString("base64")].join(":");
}

/**
 * Descifra lo que devolvió `cifrar`.
 *
 * Tira `ErrorSeguridad`:
 * - `"formato_invalido"`: no tiene los 4 segmentos esperados, el prefijo no
 *   es `"v1"`, o algún segmento no es base64 válido.
 * - `"autenticacion_fallida"`: el formato es correcto pero el tag de GCM no
 *   autentica — la clave no es la que lo cifró, o los datos fueron alterados
 *   después.
 */
export function descifrar(guardado: string, clave: Clave): string {
  const claveBytes = claveBuffer(clave);

  const partes = String(guardado ?? "").split(":");
  if (partes.length !== 4 || partes[0] !== VERSION) {
    throw new ErrorSeguridad(
      "formato_invalido",
      `El texto cifrado no tiene el formato esperado ("${VERSION}:<iv>:<tag>:<datos>").`,
    );
  }
  const [, ivB64, tagB64, datosB64] = partes as [string, string, string, string];

  let iv: Buffer;
  let tag: Buffer;
  let datos: Buffer;
  try {
    iv = Buffer.from(ivB64, "base64");
    tag = Buffer.from(tagB64, "base64");
    datos = Buffer.from(datosB64, "base64");
  } catch (error) {
    // El decodificador de base64 de Node es permisivo (no tira con basura),
    // así que este catch no es alcanzable con el `Buffer.from` actual. Queda
    // como salvaguarda si el runtime cambia esa lenidad — mismo criterio que
    // `carnet-qr`.
    /* v8 ignore next */
    throw new ErrorSeguridad("formato_invalido", "El texto cifrado tiene segmentos que no son base64 válido.", { cause: error });
  }

  try {
    const descifrador = createDecipheriv("aes-256-gcm", claveBytes, iv);
    descifrador.setAuthTag(tag);
    return Buffer.concat([descifrador.update(datos), descifrador.final()]).toString("utf8");
  } catch (error) {
    throw new ErrorSeguridad(
      "autenticacion_fallida",
      "El texto cifrado fue alterado, se cifró con otra clave, o el IV/tag no son válidos.",
      { cause: error },
    );
  }
}
