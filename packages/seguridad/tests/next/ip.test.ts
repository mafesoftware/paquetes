import { describe, expect, it } from "vitest";
import { ipDe } from "../../src/next/ip.js";

describe("ipDe", () => {
  it("con x-forwarded-for múltiple, devuelve la primera (el cliente original)", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178" });
    expect(ipDe(headers)).toBe("203.0.113.5");
  });

  it("recorta espacios de la primera IP de x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "  203.0.113.5  , 70.41.3.18" });
    expect(ipDe(headers)).toBe("203.0.113.5");
  });

  it("con una sola IP en x-forwarded-for, la devuelve", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.5" });
    expect(ipDe(headers)).toBe("203.0.113.5");
  });

  it("sin x-forwarded-for, usa x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.7" });
    expect(ipDe(headers)).toBe("198.51.100.7");
  });

  it("sin ningún header, devuelve null", () => {
    expect(ipDe(new Headers())).toBeNull();
  });

  it("x-forwarded-for vacío cae a x-real-ip", () => {
    const headers = new Headers({ "x-forwarded-for": "", "x-real-ip": "198.51.100.7" });
    expect(ipDe(headers)).toBe("198.51.100.7");
  });

  it("x-forwarded-for con solo comas/espacios cae a x-real-ip", () => {
    const headers = new Headers({ "x-forwarded-for": "   ", "x-real-ip": "198.51.100.7" });
    expect(ipDe(headers)).toBe("198.51.100.7");
  });

  describe("fix round 1 (M7): valida que el resultado tenga forma de IP", () => {
    it("acepta IPv6 en x-forwarded-for", () => {
      const headers = new Headers({ "x-forwarded-for": "2001:db8::1, 70.41.3.18" });
      expect(ipDe(headers)).toBe("2001:db8::1");
    });

    it("acepta IPv6 en x-real-ip", () => {
      const headers = new Headers({ "x-real-ip": "::1" });
      expect(ipDe(headers)).toBe("::1");
    });

    it("un x-forwarded-for que no parece una IP: null (sin x-real-ip)", () => {
      const headers = new Headers({ "x-forwarded-for": "no-es-una-ip" });
      expect(ipDe(headers)).toBeNull();
    });

    it("un x-forwarded-for con basura/inyección cae a x-real-ip si ese sí es válido", () => {
      const headers = new Headers({
        "x-forwarded-for": "<script>alert(1)</script>",
        "x-real-ip": "198.51.100.7",
      });
      expect(ipDe(headers)).toBe("198.51.100.7");
    });

    it("si ninguno de los dos headers tiene forma de IP, null", () => {
      const headers = new Headers({ "x-forwarded-for": "abc", "x-real-ip": "def" });
      expect(ipDe(headers)).toBeNull();
    });

    it("una IP con un puerto pegado ('1.2.3.4:80') no es una IP válida: null", () => {
      const headers = new Headers({ "x-forwarded-for": "1.2.3.4:80" });
      expect(ipDe(headers)).toBeNull();
    });

    it("un octeto IPv4 fuera de rango (999) no es válido: null", () => {
      const headers = new Headers({ "x-forwarded-for": "999.1.1.1" });
      expect(ipDe(headers)).toBeNull();
    });
  });
});
