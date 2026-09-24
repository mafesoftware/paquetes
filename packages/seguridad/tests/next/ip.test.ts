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
});
