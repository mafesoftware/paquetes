/**
 * El encoder DER, contra bytes conocidos.
 *
 * Los OIDs de referencia salen de la RFC: si el encoder los produce byte por
 * byte, la aritmética base-128 está bien — que es donde se equivoca todo el
 * mundo que codifica OIDs a mano.
 */

import { describe, expect, it } from "vitest";
import { hijosDe, leerTLV, oid, secuencia, tlv } from "../src/der.js";

describe("oid", () => {
  it("codifica signedData igual que la referencia", () => {
    // 1.2.840.113549.1.7.2 → 06 09 2A 86 48 86 F7 0D 01 07 02
    expect(oid("1.2.840.113549.1.7.2").toString("hex")).toBe("06092a864886f70d010702");
  });

  it("codifica sha256 igual que la referencia", () => {
    // 2.16.840.1.101.3.4.2.1 → 06 09 60 86 48 01 65 03 04 02 01
    expect(oid("2.16.840.1.101.3.4.2.1").toString("hex")).toBe("0609608648016503040201");
  });
});

describe("longitudes", () => {
  it("corta para menos de 128 bytes", () => {
    const t = tlv(0x04, Buffer.alloc(127));
    expect(t[1]).toBe(127);
  });

  it("larga para 128 o más", () => {
    const t = tlv(0x04, Buffer.alloc(300));
    // 0x82 = dos bytes de longitud; 0x012C = 300.
    expect(t.subarray(1, 4).toString("hex")).toBe("82012c");
  });
});

describe("el lector", () => {
  it("recorre lo que el encoder armó", () => {
    const adentro = [tlv(0x02, Buffer.from([1])), tlv(0x04, Buffer.from("hola"))];
    const afuera = secuencia(...adentro);
    const raiz = leerTLV(afuera, 0);
    expect(raiz.etiqueta).toBe(0x30);
    const hijos = hijosDe(raiz.contenido);
    expect(hijos).toHaveLength(2);
    expect(hijos[0]!.crudo.equals(adentro[0]!)).toBe(true);
    expect(hijos[1]!.contenido.toString()).toBe("hola");
  });
});
