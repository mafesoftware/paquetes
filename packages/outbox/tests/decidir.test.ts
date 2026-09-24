import { describe, expect, it } from "vitest";
import { decidir, type MensajeParaDecidir } from "../src/decidir.js";
import type { EstadoOutbox } from "../src/tipos.js";

const AHORA = new Date("2026-09-24T12:00:00.000Z");
const PASADO = new Date("2026-09-24T11:00:00.000Z");
const FUTURO = new Date("2026-09-24T13:00:00.000Z");

function mensaje(parcial: Partial<MensajeParaDecidir> & { estado: EstadoOutbox }): MensajeParaDecidir {
  return {
    intentos: 0,
    maxIntentos: 5,
    programadoPara: PASADO,
    proximoIntentoEn: null,
    bloqueadoHasta: null,
    ...parcial,
  };
}

describe("decidir", () => {
  it('"pendiente", programadoPara ya pasó, sin proximoIntentoEn -> "enviar"', () => {
    expect(decidir(mensaje({ estado: "pendiente" }), AHORA)).toBe("enviar");
  });

  it('"pendiente", programadoPara EXACTAMENTE ahora -> "enviar" (inclusive)', () => {
    expect(decidir(mensaje({ estado: "pendiente", programadoPara: AHORA }), AHORA)).toBe("enviar");
  });

  it('"pendiente", programadoPara futuro -> "esperar" (nunca se intentó, agendado)', () => {
    expect(decidir(mensaje({ estado: "pendiente", programadoPara: FUTURO }), AHORA)).toBe("esperar");
  });

  it('"pendiente", proximoIntentoEn futuro (ya falló una vez, esperando backoff) -> "reintentar_luego"', () => {
    expect(
      decidir(mensaje({ estado: "pendiente", intentos: 1, proximoIntentoEn: FUTURO }), AHORA),
    ).toBe("reintentar_luego");
  });

  it('"pendiente", proximoIntentoEn ya pasó -> "enviar"', () => {
    expect(
      decidir(mensaje({ estado: "pendiente", intentos: 1, proximoIntentoEn: PASADO }), AHORA),
    ).toBe("enviar");
  });

  it('"pendiente", proximoIntentoEn EXACTAMENTE ahora -> "enviar" (inclusive)', () => {
    expect(
      decidir(mensaje({ estado: "pendiente", intentos: 1, proximoIntentoEn: AHORA }), AHORA),
    ).toBe("enviar");
  });

  it('"pendiente" con intentos >= maxIntentos -> "descartar" (salvaguarda, no debería ocurrir en el flujo normal)', () => {
    expect(decidir(mensaje({ estado: "pendiente", intentos: 5, maxIntentos: 5 }), AHORA)).toBe("descartar");
  });

  it('"procesando" con bloqueadoHasta futuro -> "esperar" (otro worker la tiene ahora)', () => {
    expect(decidir(mensaje({ estado: "procesando", bloqueadoHasta: FUTURO }), AHORA)).toBe("esperar");
  });

  it('"procesando" con bloqueadoHasta ya vencido -> "destrabar"', () => {
    expect(decidir(mensaje({ estado: "procesando", bloqueadoHasta: PASADO }), AHORA)).toBe("destrabar");
  });

  it('"procesando" con bloqueadoHasta EXACTAMENTE ahora -> "destrabar" (inclusive)', () => {
    expect(decidir(mensaje({ estado: "procesando", bloqueadoHasta: AHORA }), AHORA)).toBe("destrabar");
  });

  it.each<EstadoOutbox>(["enviado", "fallido", "descartado"])('"%s" -> "descartar" (terminal)', (estado) => {
    expect(decidir(mensaje({ estado }), AHORA)).toBe("descartar");
  });
});
