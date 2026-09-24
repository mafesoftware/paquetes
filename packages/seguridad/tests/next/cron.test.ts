import { describe, expect, it } from "vitest";
import { autorizarCron } from "../../src/next/cron.js";

function requestCon(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/cron/algo", { headers });
}

describe("autorizarCron", () => {
  it("autoriza con el header Bearer correcto", () => {
    const req = requestCon({ authorization: "Bearer el-secreto" });
    expect(autorizarCron(req, "el-secreto")).toBe(true);
  });

  it("sin header authorization: 401 (false)", () => {
    const req = requestCon({});
    expect(autorizarCron(req, "el-secreto")).toBe(false);
  });

  it("con header incorrecto: false", () => {
    const req = requestCon({ authorization: "Bearer otro-valor" });
    expect(autorizarCron(req, "el-secreto")).toBe(false);
  });

  it("secreto vacío en config: falla cerrado (false), aunque el header sea 'Bearer '", () => {
    const req = requestCon({ authorization: "Bearer " });
    expect(autorizarCron(req, "")).toBe(false);
  });

  it("secreto undefined en config: falla cerrado (false)", () => {
    const req = requestCon({ authorization: "Bearer lo-que-sea" });
    expect(autorizarCron(req, undefined)).toBe(false);
  });

  it("no confunde un prefijo: 'Bearer el-secreto-extra' no autoriza para secreto 'el-secreto'", () => {
    const req = requestCon({ authorization: "Bearer el-secreto-extra" });
    expect(autorizarCron(req, "el-secreto")).toBe(false);
  });
});
