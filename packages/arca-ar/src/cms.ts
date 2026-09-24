/**
 * La firma CMS (PKCS#7 `SignedData`) del ticket de acceso del WSAA.
 *
 * ARCA pide el TRA firmado "en formato CMS" y la mayoría de las
 * implementaciones tercerizan esto en openssl o en una biblioteca de ASN.1.
 * Acá se construye a mano —son siete TLVs— y **los tests lo verifican contra
 * openssl de verdad** (`openssl cms -verify`), que es lo que le da derecho a
 * existir: un byte corrido no compila una queja, produce un CMS que ARCA
 * rechaza con un error que no dice nada.
 *
 * Decisiones:
 * - **Sin atributos firmados** (`signedAttrs`). La RFC 5652 los hace
 *   opcionales cuando el contenido es `id-data`, y sin ellos la firma es
 *   directamente sobre el TRA: menos estructura, menos lugares donde
 *   equivocarse. openssl y ARCA lo verifican igual.
 * - **SHA-256 con RSA**, que es lo que emite la autoridad de ARCA hoy.
 */

import { createSign } from "node:crypto";
import {
  NULO,
  conjunto,
  contexto,
  entero,
  hijosDe,
  leerTLV,
  octetos,
  oid,
  secuencia,
} from "./der.js";

const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_DATA = "1.2.840.113549.1.7.1";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_SHA256_CON_RSA = "1.2.840.113549.1.1.11";

/** PEM → DER: saca cabeceras y decodifica el base64. */
export function pemADer(pem: string): Buffer {
  const cuerpo = pem
    .replace(/-----(BEGIN|END)[^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!cuerpo) throw new Error("El PEM está vacío o no es un PEM.");
  return Buffer.from(cuerpo, "base64");
}

/**
 * Del certificado, lo que el `SignerInfo` tiene que nombrar: el emisor y el
 * número de serie, copiados BYTE POR BYTE del certificado — recodificarlos es
 * la clase de "mejora" que produce una firma que no matchea con nada.
 */
export function emisorYSerie(certDer: Buffer): { emisor: Buffer; serie: Buffer } {
  const certificado = leerTLV(certDer, 0);
  const tbs = leerTLV(certificado.contenido, 0);
  const campos = hijosDe(tbs.contenido);

  // El primer campo puede ser la versión ([0] EXPLICIT) o directamente el
  // número de serie, según si el certificado la declara.
  let i = 0;
  if (campos[0]!.etiqueta === 0xa0) i = 1;
  const serie = campos[i]!.crudo; // INTEGER
  // Después de la serie viene el AlgorithmIdentifier y recién ahí el emisor.
  const emisor = campos[i + 2]!.crudo; // Name (SEQUENCE)
  return { emisor, serie };
}

/**
 * Firma `contenido` y devuelve el CMS `SignedData` completo, en DER.
 *
 * `certPem` es el certificado emitido por ARCA y `clavePem` su clave privada.
 */
export function firmarCMS(
  contenido: Buffer | string,
  certPem: string,
  clavePem: string
): Buffer {
  const datos = typeof contenido === "string" ? Buffer.from(contenido, "utf8") : contenido;
  const certDer = pemADer(certPem);
  const { emisor, serie } = emisorYSerie(certDer);

  const firma = createSign("RSA-SHA256").update(datos).sign(clavePem);

  const algoritmoDigesto = secuencia(oid(OID_SHA256), NULO);
  const algoritmoFirma = secuencia(oid(OID_SHA256_CON_RSA), NULO);

  const signerInfo = secuencia(
    entero(1), // versión: emisor y serie
    secuencia(Buffer.from(emisor), Buffer.from(serie)),
    algoritmoDigesto,
    algoritmoFirma,
    octetos(firma)
  );

  const signedData = secuencia(
    entero(1),
    conjunto(algoritmoDigesto),
    // El contenido viaja ADENTRO (attached): el WSAA no recibe el TRA por
    // otro lado, así que una firma detached no le serviría para nada.
    secuencia(oid(OID_DATA), contexto(0, octetos(datos))),
    // certificates [0] IMPLICIT: el certificado tal cual vino, sin recodificar.
    contexto(0, certDer),
    conjunto(signerInfo)
  );

  return secuencia(oid(OID_SIGNED_DATA), contexto(0, signedData));
}

/** El CMS en base64, que es como viaja dentro del SOAP de `loginCms`. */
export function firmarCMSBase64(
  contenido: Buffer | string,
  certPem: string,
  clavePem: string
): string {
  return firmarCMS(contenido, certPem, clavePem).toString("base64");
}
