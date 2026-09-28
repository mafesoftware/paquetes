import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { borrarEnLote } from "../src/index.js";
import { clienteDePrueba } from "./cliente-de-prueba.js";

describe("borrarEnLote", () => {
  const bucket = "mi-bucket-de-prueba";
  let cliente: ReturnType<typeof clienteDePrueba>;
  let send: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cliente = clienteDePrueba();
    send = vi.spyOn(cliente, "send");
  });

  it("borra un lote chico en un solo request", async () => {
    send.mockResolvedValue({
      Deleted: [{ Key: "a.pdf" }, { Key: "b.pdf" }],
      Errors: [],
    } as never);

    const resultado = await borrarEnLote({ cliente, bucket, claves: ["a.pdf", "b.pdf"] });

    expect(resultado).toEqual({ ok: true, borradas: 2, errores: [] });
    expect(send).toHaveBeenCalledTimes(1);
    const comando = send.mock.calls[0]?.[0];
    expect(comando).toBeInstanceOf(DeleteObjectsCommand);
    expect(comando.input).toEqual({
      Bucket: bucket,
      Delete: { Objects: [{ Key: "a.pdf" }, { Key: "b.pdf" }], Quiet: false },
    });
  });

  it("con 0 claves no llama a S3 para nada", async () => {
    const resultado = await borrarEnLote({ cliente, bucket, claves: [] });

    expect(resultado).toEqual({ ok: true, borradas: 0, errores: [] });
    expect(send).not.toHaveBeenCalled();
  });

  it("parte más de 1000 claves en dos requests (el límite de DeleteObjectsCommand)", async () => {
    send.mockResolvedValue({ Deleted: [], Errors: [] } as never);
    const claves = Array.from({ length: 1500 }, (_, i) => `archivo-${i}.pdf`);

    await borrarEnLote({ cliente, bucket, claves });

    expect(send).toHaveBeenCalledTimes(2);
    const primerLote = send.mock.calls[0]?.[0].input.Delete.Objects;
    const segundoLote = send.mock.calls[1]?.[0].input.Delete.Objects;
    expect(primerLote).toHaveLength(1000);
    expect(segundoLote).toHaveLength(500);
  });

  it("una respuesta sin 'Deleted' ni 'Errors' no rompe (S3 los omite si vienen vacíos con Quiet)", async () => {
    send.mockResolvedValue({} as never);

    const resultado = await borrarEnLote({ cliente, bucket, claves: ["a.pdf"] });

    expect(resultado).toEqual({ ok: true, borradas: 0, errores: [] });
  });

  it("un borrado parcial se informa en 'errores' sin fallar la operación (no feliz)", async () => {
    send.mockResolvedValue({
      Deleted: [{ Key: "a.pdf" }],
      Errors: [{ Key: "b.pdf", Code: "AccessDenied", Message: "No autorizado" }],
    } as never);

    const resultado = await borrarEnLote({ cliente, bucket, claves: ["a.pdf", "b.pdf"] });

    expect(resultado.ok).toBe(true);
    expect(resultado.borradas).toBe(1);
    expect(resultado.errores).toEqual([{ clave: "b.pdf", codigo: "AccessDenied", mensaje: "No autorizado" }]);
  });
});
