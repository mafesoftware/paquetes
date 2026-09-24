import { describe, expect, it, vi } from "vitest";
import { auditar } from "../../src/drizzle/auditar.js";
import { tablaAuditoria } from "../../src/drizzle/tabla.js";
import type { DbCliente } from "../../src/drizzle/cliente.js";

/**
 * N5: el resumen que loguea `auditar` cuando falla NUNCA tiene que leer
 * `error.message`/`error.code` del error de AFUERA (el `DrizzleQueryError`
 * que arma Drizzle) — solo de `error.cause` (el error real de `pg`). El
 * `.message` de un `DrizzleQueryError` es justamente `"Failed query:
 * <sql>\nparams: <valores>"`: si `auditar` cayera de vuelta a leerlo cuando
 * `error.cause` falta, filtraría el SQL armado y los parámetros.
 *
 * NO hace falta Postgres real para este test: `auditar` solo llama a
 * `dbOTx.transaction(...)` antes de tocar la base — un `dbOTx` FALSO cuyo
 * `.transaction()` tira un error SINTÉTICO (sin `.cause`, con un `.message`
 * que imita el de un `DrizzleQueryError` real) alcanza para probar el
 * fallback sin conexión. `tabla` sí tiene que ser una `TablaAuditoria` real
 * (para que `auditar` pueda leer `tabla.x.name` de cada columna antes de
 * llegar a `dbOTx.transaction`), pero `tablaAuditoria()` no toca la base —
 * es solo la forma de la tabla en memoria.
 */
describe("N5 — resumenDeError nunca lee error.message del wrapper (DrizzleQueryError sintético, sin cause)", () => {
  const tabla = tablaAuditoria({ nombre: "auditoria_log_seguro_test" });

  function dbFalsoQueTira(error: unknown): DbCliente {
    return {
      transaction: async () => {
        throw error;
      },
    } as unknown as DbCliente;
  }

  it("sin error.cause: el log usa el fallback genérico, nunca el .message del wrapper (que trae el SQL + params)", async () => {
    const secretoEnParams = "valor-secreto-que-nunca-deberia-aparecer-en-el-log";
    const errorSintetico = Object.assign(
      new Error(
        `Failed query: \n        insert into "auditoria_log_seguro_test" (...)\n        values (...)\nparams: ${secretoEnParams}`,
      ),
      {
        name: "DrizzleQueryError",
        query: 'insert into "auditoria_log_seguro_test" (...)',
        params: [secretoEnParams],
        // Sin "cause" a propósito: es el caso que este test cubre.
      },
    );

    const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const resultado = await auditar(dbFalsoQueTira(errorSintetico), tabla, {
        tenantId: "11111111-1111-1111-1111-111111111111",
        entidad: "test",
        entidadId: "1",
        accion: "crear",
        actor: { tipo: "sistema" },
      });

      expect(resultado.ok).toBe(false);
      expect(spyError).toHaveBeenCalledTimes(1);

      const textoLogueado = spyError.mock.calls.flat().map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");

      expect(textoLogueado).not.toContain(secretoEnParams);
      expect(textoLogueado).not.toContain("Failed query");
      expect(textoLogueado).not.toContain("params:");
      expect(textoLogueado).not.toContain("insert into");
      expect(textoLogueado).toContain("error de base de datos sin detalle");

      // Ronda 3: resultado.error también es { codigo, mensaje } sanitizado
      // — no el errorSintetico crudo (que SÍ tenía .query/.params propios).
      if (resultado.ok) throw new Error("no debería pasar");
      expect(resultado.error).toEqual({ codigo: null, mensaje: "error de base de datos sin detalle" });
      expect(resultado.error).not.toHaveProperty("query");
      expect(resultado.error).not.toHaveProperty("params");
      const textoDelError = JSON.stringify(resultado.error);
      expect(textoDelError).not.toContain(secretoEnParams);
    } finally {
      spyError.mockRestore();
    }
  });

  it("con error.cause pero SU message trae \"Failed query\"/\"params:\" (caso patológico): igual se filtra, cae al genérico", async () => {
    const errorSintetico = Object.assign(new Error("Failed query: algo\nparams: secreto-xyz"), {
      cause: { code: "23514", message: "Failed query: algo\nparams: secreto-xyz" },
    });

    const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const resultado = await auditar(dbFalsoQueTira(errorSintetico), tabla, {
        tenantId: "11111111-1111-1111-1111-111111111111",
        entidad: "test",
        entidadId: "1",
        accion: "crear",
        actor: { tipo: "sistema" },
      });
      expect(resultado.ok).toBe(false);

      const textoLogueado = spyError.mock.calls.flat().map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
      expect(textoLogueado).not.toContain("secreto-xyz");
      expect(textoLogueado).not.toContain("params:");
      // El "code" (23514) SÍ es seguro y sigue apareciendo, aunque el message se haya filtrado.
      expect(textoLogueado).toContain("23514");

      if (resultado.ok) throw new Error("no debería pasar");
      expect(resultado.error).toEqual({ codigo: "23514", mensaje: "error de base de datos sin detalle" });
      expect(JSON.stringify(resultado.error)).not.toContain("secreto-xyz");
    } finally {
      spyError.mockRestore();
    }
  });

  it("con error.cause normal (code + message de Postgres reales): esos SÍ se loguean y se devuelven", async () => {
    const errorSintetico = Object.assign(new Error("Failed query: ...\nparams: ..."), {
      cause: { code: "23514", message: 'new row for relation "x" violates check constraint "y"' },
    });

    const spyError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const resultado = await auditar(dbFalsoQueTira(errorSintetico), tabla, {
        tenantId: "11111111-1111-1111-1111-111111111111",
        entidad: "test",
        entidadId: "1",
        accion: "crear",
        actor: { tipo: "sistema" },
      });
      const textoLogueado = spyError.mock.calls.flat().map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
      expect(textoLogueado).toContain("23514");
      expect(textoLogueado).toContain("check constraint");

      if (resultado.ok) throw new Error("no debería pasar");
      expect(resultado.error).toEqual({ codigo: "23514", mensaje: 'new row for relation "x" violates check constraint "y"' });
    } finally {
      spyError.mockRestore();
    }
  });
});
