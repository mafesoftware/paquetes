/**
 * Lo mínimo de ASN.1/DER que necesita una firma CMS: un encoder de TLVs y un
 * lector que camina una estructura ya codificada (el certificado).
 *
 * No es una biblioteca de ASN.1 y no lo pretende: son las siete formas que
 * aparecen en un `SignedData`, escritas a mano para no arrastrar una
 * dependencia por esto. Cada byte está donde la RFC 5652 dice.
 */

/* ---------- encoder ---------- */

/** La longitud en DER: corta (un byte) o larga (0x8N + N bytes big-endian). */
function longitud(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let resto = n;
  while (resto > 0) {
    bytes.unshift(resto & 0xff);
    resto >>>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** Un TLV: etiqueta, longitud y contenido. */
export function tlv(etiqueta: number, contenido: Buffer): Buffer {
  return Buffer.concat([Buffer.from([etiqueta]), longitud(contenido.length), contenido]);
}

export const secuencia = (...partes: Buffer[]) => tlv(0x30, Buffer.concat(partes));
export const conjunto = (...partes: Buffer[]) => tlv(0x31, Buffer.concat(partes));
export const octetos = (datos: Buffer) => tlv(0x04, datos);
/** Contexto [n] EXPLICIT: envuelve otro TLV. */
export const contexto = (n: number, contenido: Buffer) => tlv(0xa0 | n, contenido);

export function entero(n: number): Buffer {
  // Solo se usan enteros chicos y positivos (las versiones de CMS: 1).
  if (n < 0 || n > 127) throw new Error(`entero DER fuera de rango: ${n}`);
  return tlv(0x02, Buffer.from([n]));
}

/** Un OID en puntos ("1.2.840.113549.1.7.2") a su forma DER. */
export function oid(texto: string): Buffer {
  const partes = texto.split(".").map(Number);
  const primero = partes[0]! * 40 + partes[1]!;
  const bytes: number[] = [primero];
  for (const p of partes.slice(2)) {
    if (p < 0x80) {
      bytes.push(p);
      continue;
    }
    // Base 128 con bit alto en todos menos el último.
    const grupo: number[] = [];
    let resto = p;
    while (resto > 0) {
      grupo.unshift(resto & 0x7f);
      resto >>>= 7;
    }
    for (let i = 0; i < grupo.length - 1; i++) grupo[i]! |= 0x80;
    bytes.push(...grupo);
  }
  return tlv(0x06, Buffer.from(bytes));
}

export const NULO = Buffer.from([0x05, 0x00]);

/* ---------- lector ---------- */

export type TLV = {
  etiqueta: number;
  /** El TLV completo, con etiqueta y longitud: para copiarlo tal cual. */
  crudo: Buffer;
  /** Solo el contenido. */
  contenido: Buffer;
};

/** Lee el TLV que empieza en `desde` y dice dónde termina. */
export function leerTLV(datos: Buffer, desde: number): TLV & { fin: number } {
  const etiqueta = datos[desde]!;
  let cursor = desde + 1;
  let largo = datos[cursor]!;
  cursor++;
  if (largo & 0x80) {
    const cuantos = largo & 0x7f;
    largo = 0;
    for (let i = 0; i < cuantos; i++) {
      largo = largo * 256 + datos[cursor]!;
      cursor++;
    }
  }
  const contenido = datos.subarray(cursor, cursor + largo);
  const fin = cursor + largo;
  return { etiqueta, crudo: datos.subarray(desde, fin), contenido, fin };
}

/** Los TLVs hijos directos de un contenido. */
export function hijosDe(contenido: Buffer): TLV[] {
  const hijos: TLV[] = [];
  let cursor = 0;
  while (cursor < contenido.length) {
    const t = leerTLV(contenido, cursor);
    hijos.push(t);
    cursor = t.fin;
  }
  return hijos;
}
