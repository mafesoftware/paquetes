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
 * **Un caso borde documentado, no un bug:** `cifrar("")` produce un
 * segmento `<datos>` vacío (la codificación base64 de cero bytes es la
 * cadena vacía). El `descifrar` de ESTE paquete lo lee perfecto. La
 * implementación vieja de `fiscalCifrado.ts` en store360, si valida el
 * formato con un split ingenuo, podría llegar a rechazar ese segmento vacío
 * — es aceptable: cifrar un string vacío es un caso de uso raro (¿para qué
 * cifrar nada?), y no rompe la compatibilidad para lo que store360 realmente
 * guarda (certificados, tokens, siempre no vacíos).
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
 *
 * ## Por qué todo se decodifica en base64 ESTRICTO
 *
 * El decodificador de base64 de Node es MUY permisivo: acepta indistintamente
 * el alfabeto estándar (`+`/`/`) y el url-safe (`-`/`_`), ignora caracteres
 * que no reconoce, y no valida que los bits de relleno de un `=` sean cero.
 * Eso significa que dos strings DISTINTOS pueden decodificar al mismo buffer
 * (o casi), lo cual es exactamente lo que no querés en algo que se usa como
 * clave criptográfica o como IV/tag de autenticación. `claveBuffer` y
 * `descifrar` solo aceptan base64 estándar CANÓNICO (charset correcto,
 * relleno en la posición correcta, y el resultado de re-codificar el buffer
 * decodificado tiene que dar el mismo string de vuelta).
 *
 * ## Por qué el IV y el tag tienen que tener el largo EXACTO
 *
 * `createDecipheriv`/`setAuthTag` de Node, sin pedirles explícitamente un
 * largo de tag, aceptan tags truncados (8, 4 bytes...) y los autentican
 * igual — un tag más corto es muchísimo más fácil de falsificar por fuerza
 * bruta. Por eso acá se valida `iv.length === 12` y `tag.length === 16` ANTES
 * de tocar `node:crypto`, y además se le pasa `authTagLength: 16` a
 * `createDecipheriv`/`createCipheriv` para que el propio Node lo exija (y
 * para no disparar el warning `DEP0182` de Node, que avisa exactamente de
 * este uso implícito).
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ErrorSeguridad } from "./errores.js";

const VERSION = "v1";
/** AES-256: 32 bytes de clave. */
const LARGO_CLAVE = 32;
/** El largo de IV recomendado para GCM (NIST SP 800-38D): 96 bits. Se exige EXACTO, no "al menos". */
const LARGO_IV = 12;
/** AES-GCM: tag de autenticación de 128 bits completos. Un tag truncado es más fácil de falsificar; se exige EXACTO. */
const LARGO_TAG = 16;

/** Solo base64 ESTÁNDAR (`+`/`/`), con o sin relleno `=` en la posición correcta. Nunca base64url. */
const BASE64_ESTANDAR = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Decodifica base64 estándar CANÓNICO, o `null` si no lo es: charset
 * equivocado (base64url, basura), largo mal formado, o relleno con bits no
 * nulos (una entrada que decodifica pero, re-codificada, no da el mismo
 * string — señal de que no es la representación canónica de esos bytes).
 */
function base64Canonico(valor: string): Buffer | null {
  if (typeof valor !== "string" || !BASE64_ESTANDAR.test(valor)) return null;
  const buffer = Buffer.from(valor, "base64");
  if (buffer.toString("base64") !== valor) return null;
  return buffer;
}

/** Una clave de 32 bytes: en base64 ESTÁNDAR canónico (como la devuelve `openssl rand -base64 32`) o ya decodificada. */
export type Clave = string | Uint8Array;

function claveBuffer(clave: Clave): Buffer {
  let buffer: Buffer;
  if (typeof clave === "string") {
    const decodificada = base64Canonico(clave);
    if (!decodificada) {
      throw new ErrorSeguridad(
        "clave_invalida",
        `La clave, si es un string, tiene que ser base64 estándar canónico (no base64url, sin caracteres de más ni relleno no estándar). Generala con "openssl rand -base64 32".`,
      );
    }
    buffer = decodificada;
  } else {
    buffer = Buffer.from(clave);
  }
  if (buffer.length !== LARGO_CLAVE) {
    throw new ErrorSeguridad(
      "clave_invalida",
      `La clave tiene que ser de ${LARGO_CLAVE} bytes (AES-256); recibió ${buffer.length}.`,
    );
  }
  return buffer;
}

/** Cifra `textoPlano` con AES-256-GCM. Devuelve `"v1:<iv>:<tag>:<datos>"`, todo en base64. */
export function cifrar(textoPlano: string, clave: Clave): string {
  const claveBytes = claveBuffer(clave);
  const iv = randomBytes(LARGO_IV);
  const cifrador = createCipheriv("aes-256-gcm", claveBytes, iv, { authTagLength: LARGO_TAG });
  const datos = Buffer.concat([cifrador.update(textoPlano, "utf8"), cifrador.final()]);
  const tag = cifrador.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), datos.toString("base64")].join(":");
}

/**
 * Descifra lo que devolvió `cifrar`.
 *
 * Tira `ErrorSeguridad`:
 * - `"formato_invalido"`: no tiene los 4 segmentos esperados, el prefijo no
 *   es `"v1"`, algún segmento no es base64 estándar canónico, o el IV/tag no
 *   tienen el largo exacto (12/16 bytes — ver la cabecera del archivo).
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

  const iv = base64Canonico(ivB64);
  const tag = base64Canonico(tagB64);
  const datos = base64Canonico(datosB64);
  if (!iv || !tag || !datos) {
    throw new ErrorSeguridad("formato_invalido", "El texto cifrado tiene segmentos que no son base64 estándar canónico.");
  }
  if (iv.length !== LARGO_IV || tag.length !== LARGO_TAG) {
    throw new ErrorSeguridad(
      "formato_invalido",
      `El IV tiene que ser de ${LARGO_IV} bytes y el tag de ${LARGO_TAG}; recibió iv=${iv.length}, tag=${tag.length}.`,
    );
  }

  try {
    const descifrador = createDecipheriv("aes-256-gcm", claveBytes, iv, { authTagLength: LARGO_TAG });
    descifrador.setAuthTag(tag);
    return Buffer.concat([descifrador.update(datos), descifrador.final()]).toString("utf8");
  } catch (error) {
    throw new ErrorSeguridad(
      "autenticacion_fallida",
      "El texto cifrado fue alterado o se cifró con otra clave: el tag de GCM no autentica.",
      { cause: error },
    );
  }
}
