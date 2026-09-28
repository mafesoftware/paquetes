import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { promover } from "../src/index.js";
import { clienteDePrueba } from "./cliente-de-prueba.js";

describe("promover", () => {
  const bucket = "mi-bucket-de-prueba";
  let cliente: ReturnType<typeof clienteDePrueba>;
  let send: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cliente = clienteDePrueba();
    send = vi.spyOn(cliente, "send").mockResolvedValue({} as never);
  });

  it("copia el objeto a la clave final y borra la temporal, en ese orden", async () => {
    const resultado = await promover({
      cliente,
      bucket,
      claveTemporal: "pending/abc123-factura.pdf",
      claveFinal: "org-1/facturas/factura.pdf",
    });

    expect(resultado).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);

    const comandoCopia = send.mock.calls[0]?.[0];
    expect(comandoCopia).toBeInstanceOf(CopyObjectCommand);
    expect(comandoCopia.input).toEqual({
      Bucket: bucket,
      CopySource: `${bucket}/pending/abc123-factura.pdf`,
      Key: "org-1/facturas/factura.pdf",
    });

    const comandoBorrado = send.mock.calls[1]?.[0];
    expect(comandoBorrado).toBeInstanceOf(DeleteObjectCommand);
    expect(comandoBorrado.input).toEqual({ Bucket: bucket, Key: "pending/abc123-factura.pdf" });
  });

  it("codifica cada segmento de CopySource por separado (preserva las '/')", async () => {
    await promover({
      cliente,
      bucket,
      claveTemporal: "pending/carpeta con espacios/abc-archivo raro#1.pdf",
      claveFinal: "org-1/archivo raro#1.pdf",
    });

    const comandoCopia = send.mock.calls[0]?.[0];
    expect(comandoCopia.input.CopySource).toBe(
      `${bucket}/pending/carpeta%20con%20espacios/abc-archivo%20raro%231.pdf`,
    );
  });

  it("respeta un prefijoTemporal propio", async () => {
    const resultado = await promover({
      cliente,
      bucket,
      claveTemporal: "tmp/abc123-factura.pdf",
      claveFinal: "org-1/factura.pdf",
      prefijoTemporal: "tmp/",
    });
    expect(resultado).toEqual({ ok: true });
  });

  it("rechaza una claveTemporal que no está bajo el prefijo temporal (no feliz)", async () => {
    const resultado = await promover({
      cliente,
      bucket,
      claveTemporal: "org-1/ya-promovido/archivo.pdf",
      claveFinal: "org-1/otro-lugar/archivo.pdf",
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error("debería fallar");
    expect(resultado.error.codigo).toBe("clave_invalida");
    expect(send).not.toHaveBeenCalled();
  });

  it("rechaza una claveTemporal con traversal (no feliz)", async () => {
    const resultado = await promover({
      cliente,
      bucket,
      claveTemporal: "pending/../org-2/secreto.pdf",
      claveFinal: "org-1/archivo.pdf",
    });
    expect(resultado.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("rechaza una claveFinal con '/' inicial (no feliz)", async () => {
    const resultado = await promover({
      cliente,
      bucket,
      claveTemporal: "pending/abc-archivo.pdf",
      claveFinal: "/etc/passwd",
    });
    expect(resultado.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("rechaza una claveFinal que sigue bajo el prefijo temporal (no feliz)", async () => {
    const resultado = await promover({
      cliente,
      bucket,
      claveTemporal: "pending/abc-archivo.pdf",
      claveFinal: "pending/abc-archivo.pdf",
    });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) throw new Error("debería fallar");
    expect(resultado.error.codigo).toBe("clave_invalida");
    expect(send).not.toHaveBeenCalled();
  });
});
