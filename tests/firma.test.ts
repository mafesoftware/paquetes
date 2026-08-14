import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verificarFirmaWebhook } from "../src/firma.js";

const SECRETO = "un-secreto-de-prueba";

/** Arma una cabecera x-signature válida, como la que manda MP. */
function firmar(dataId: string, requestId: string, ts = "1704908010") {
  const manifiesto = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", SECRETO).update(manifiesto).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

describe("verificarFirmaWebhook", () => {
  it("acepta una firma correcta", () => {
    expect(
      verificarFirmaWebhook({
        cabeceraFirma: firmar("123456", "req-1"),
        requestId: "req-1",
        dataId: "123456",
        secreto: SECRETO,
      })
    ).toBe(true);
  });

  it("rechaza si el secreto no es el mismo", () => {
    expect(
      verificarFirmaWebhook({
        cabeceraFirma: firmar("123456", "req-1"),
        requestId: "req-1",
        dataId: "123456",
        secreto: "otro-secreto",
      })
    ).toBe(false);
  });

  it("rechaza si alguien cambia el id del pago pero deja la firma", () => {
    expect(
      verificarFirmaWebhook({
        cabeceraFirma: firmar("123456", "req-1"),
        requestId: "req-1",
        dataId: "999999",
        secreto: SECRETO,
      })
    ).toBe(false);
  });

  it("pasa a minusculas el dataId cuando no es numerico, como hace MP", () => {
    const manifiesto = `id:abc-def;request-id:req-1;ts:1704908010;`;
    const v1 = createHmac("sha256", SECRETO).update(manifiesto).digest("hex");
    expect(
      verificarFirmaWebhook({
        cabeceraFirma: `ts=1704908010,v1=${v1}`,
        requestId: "req-1",
        dataId: "ABC-DEF",
        secreto: SECRETO,
      })
    ).toBe(true);
  });

  it("rechaza una cabecera sin v1 o sin ts", () => {
    for (const cabecera of ["ts=1704908010", "v1=deadbeef", "cualquier cosa"]) {
      expect(
        verificarFirmaWebhook({
          cabeceraFirma: cabecera,
          requestId: "req-1",
          dataId: "123456",
          secreto: SECRETO,
        })
      ).toBe(false);
    }
  });

  it("rechaza si falta la cabecera, el requestId o el dataId", () => {
    const base = {
      cabeceraFirma: firmar("123456", "req-1") as string | null,
      requestId: "req-1" as string | null,
      dataId: "123456" as string | null,
      secreto: SECRETO,
    };
    expect(verificarFirmaWebhook({ ...base, cabeceraFirma: null })).toBe(false);
    expect(verificarFirmaWebhook({ ...base, requestId: null })).toBe(false);
    expect(verificarFirmaWebhook({ ...base, dataId: null })).toBe(false);
  });

  it("sin secreto RECHAZA por defecto: nadie debe poder forjar un pago aprobado", () => {
    expect(
      verificarFirmaWebhook({
        cabeceraFirma: firmar("123456", "req-1"),
        requestId: "req-1",
        dataId: "123456",
        secreto: null,
      })
    ).toBe(false);
  });

  it("sin secreto acepta SOLO si se pide explicitamente (dev)", () => {
    expect(
      verificarFirmaWebhook({
        cabeceraFirma: null,
        requestId: null,
        dataId: null,
        secreto: null,
        permitirSinSecreto: true,
      })
    ).toBe(true);
  });
});
