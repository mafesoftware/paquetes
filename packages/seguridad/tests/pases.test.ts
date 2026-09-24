import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { crearPase, verificarPase } from "../src/pases.js";

const SECRETO = "un-secreto-de-firma";

describe("crearPase / verificarPase", () => {
  it("un pase recién creado verifica ok, con el mismo propósito y sello", () => {
    const token = crearPase(
      { proposito: "reset-password", sujeto: "usuario-1", venceEn: Date.now() + 60_000, sello: "sello-actual" },
      SECRETO,
    );
    const resultado = verificarPase(token, SECRETO, {
      proposito: "reset-password",
      selloActual: "sello-actual",
      ahora: Date.now(),
    });
    expect(resultado).toEqual({ ok: true, sujeto: "usuario-1" });
  });

  it("acepta venceEn como Date, no solo como epoch ms", () => {
    const token = crearPase(
      { proposito: "invitacion", sujeto: "socio-42", venceEn: new Date(Date.now() + 60_000), sello: "s" },
      SECRETO,
    );
    const resultado = verificarPase(token, SECRETO, { proposito: "invitacion", selloActual: "s" });
    expect(resultado).toEqual({ ok: true, sujeto: "socio-42" });
  });

  it("token vacío o sin puntos: formato", () => {
    expect(verificarPase("", SECRETO, { proposito: "x", selloActual: "s" })).toEqual({
      ok: false,
      motivo: "formato",
    });
    expect(verificarPase("sin-punto", SECRETO, { proposito: "x", selloActual: "s" })).toEqual({
      ok: false,
      motivo: "formato",
    });
  });

  it("token null/undefined (llamada desde JS sin chequeo de tipos): formato, no una excepción", () => {
    expect(verificarPase(null as never, SECRETO, { proposito: "x", selloActual: "s" })).toEqual({
      ok: false,
      motivo: "formato",
    });
  });

  it("firma alterada: firma", () => {
    const token = crearPase({ proposito: "magic-link", sujeto: "u1", venceEn: Date.now() + 60_000, sello: "s" }, SECRETO);
    const [payload] = token.split(".");
    const adulterado = `${payload}.firma-inventada`;
    expect(verificarPase(adulterado, SECRETO, { proposito: "magic-link", selloActual: "s" })).toEqual({
      ok: false,
      motivo: "firma",
    });
  });

  it("firmado con otro secreto: firma", () => {
    const token = crearPase({ proposito: "magic-link", sujeto: "u1", venceEn: Date.now() + 60_000, sello: "s" }, SECRETO);
    expect(verificarPase(token, "otro-secreto", { proposito: "magic-link", selloActual: "s" })).toEqual({
      ok: false,
      motivo: "firma",
    });
  });

  it("payload alterado (rompe la firma): firma", () => {
    const token = crearPase({ proposito: "magic-link", sujeto: "u1", venceEn: Date.now() + 60_000, sello: "s" }, SECRETO);
    const [, firma] = token.split(".");
    const payloadFalso = Buffer.from(JSON.stringify({ p: "magic-link", s: "otro-usuario", v: Date.now() + 60_000, h: "s" })).toString(
      "base64url",
    );
    const adulterado = `${payloadFalso}.${firma}`;
    expect(verificarPase(adulterado, SECRETO, { proposito: "magic-link", selloActual: "s" })).toEqual({
      ok: false,
      motivo: "firma",
    });
  });

  it("pase vencido: vencido", () => {
    const token = crearPase({ proposito: "reset-password", sujeto: "u1", venceEn: Date.now() - 1000, sello: "s" }, SECRETO);
    expect(verificarPase(token, SECRETO, { proposito: "reset-password", selloActual: "s" })).toEqual({
      ok: false,
      motivo: "vencido",
    });
  });

  it("propósito distinto al que se firmó: proposito", () => {
    const token = crearPase({ proposito: "reset-password", sujeto: "u1", venceEn: Date.now() + 60_000, sello: "s" }, SECRETO);
    expect(verificarPase(token, SECRETO, { proposito: "invitacion", selloActual: "s" })).toEqual({
      ok: false,
      motivo: "proposito",
    });
  });

  it("sello cambiado (contraseña ya cambiada): sello", () => {
    const token = crearPase(
      { proposito: "reset-password", sujeto: "u1", venceEn: Date.now() + 60_000, sello: "hash-viejo" },
      SECRETO,
    );
    // El passwordHash cambió después de emitir el pase: el sello actual ya no coincide.
    const resultado = verificarPase(token, SECRETO, { proposito: "reset-password", selloActual: "hash-nuevo" });
    expect(resultado).toEqual({ ok: false, motivo: "sello" });
  });

  it("payload que no es JSON válido (pero con firma que coincidiría si lo fuera no aplica): formato", () => {
    // No se puede fabricar una firma válida sin el secreto, así que se prueba
    // el camino de "formato" con un token propio cuyo payload se reemplaza
    // por basura, firmado igual: la firma sobre la basura si es válida.
    const payload = Buffer.from("no es json").toString("base64url");
    // Se firma la basura de verdad con el mismo HMAC que usa el módulo, para
    // que el camino de "firma" no tape el de "formato".
    const token = `${payload}.${firmaDe(payload, SECRETO)}`;
    expect(verificarPase(token, SECRETO, { proposito: "x", selloActual: "s" })).toEqual({
      ok: false,
      motivo: "formato",
    });
  });

  it("payload con campos faltantes o de tipo incorrecto: formato", () => {
    const payload = Buffer.from(JSON.stringify({ p: "x", s: "y" })).toString("base64url"); // sin v ni h
    const token = `${payload}.${firmaDe(payload, SECRETO)}`;
    expect(verificarPase(token, SECRETO, { proposito: "x", selloActual: "s" })).toEqual({
      ok: false,
      motivo: "formato",
    });
  });

  it("payload JSON válido pero no-objeto (null): formato", () => {
    const payload = Buffer.from("null").toString("base64url");
    const token = `${payload}.${firmaDe(payload, SECRETO)}`;
    expect(verificarPase(token, SECRETO, { proposito: "x", selloActual: "s" })).toEqual({
      ok: false,
      motivo: "formato",
    });
  });

  it("ahora por defecto es Date.now(): sin pasar ahora, un pase futuro sigue vigente", () => {
    const token = crearPase({ proposito: "x", sujeto: "u", venceEn: Date.now() + 5000, sello: "s" }, SECRETO);
    expect(verificarPase(token, SECRETO, { proposito: "x", selloActual: "s" })).toEqual({ ok: true, sujeto: "u" });
  });
});

/** Reimplementa la firma HMAC del módulo, para armar tokens "propios" en los tests de formato. */
function firmaDe(payload: string, secreto: string): string {
  return createHmac("sha256", secreto).update(payload).digest("base64url");
}
