import { describe, expect, it } from "vitest";
import { ErrorMP } from "../src/errores.js";
import { calcularComision, crearPreferencia } from "../src/preferencias.js";

const ITEMS = [
  { id: "sku-1", titulo: "Serum de niacinamida", cantidad: 2, precioUnitario: 12000 },
  { id: "sku-2", titulo: "Protector solar", cantidad: 1, precioUnitario: 16000 },
];

const BASE = {
  accessToken: "TOKEN-DE-LA-DUENIA",
  items: ITEMS,
  referenciaExterna: "P-123456",
  urlDeNotificacion: "https://bestie.com/api/mercadopago/webhook",
  urlsDeVuelta: {
    exito: "https://bestie.com/cuenta?pago=exito",
    error: "https://bestie.com/cuenta?pago=error",
    pendiente: "https://bestie.com/cuenta?pago=pendiente",
  },
};

function capturarCuerpo(
  respuesta: unknown = {
    id: "pref-1",
    init_point: "https://mp/checkout",
    sandbox_init_point: "https://mp/sandbox",
  }
) {
  const cuerpos: Record<string, unknown>[] = [];
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify(respuesta), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fn, cuerpos };
}

describe("calcularComision", () => {
  it("calcula sobre el total, en puntos basicos", () => {
    // 2 * 12000 + 16000 = 40000; 2,5% = 1000
    expect(calcularComision(ITEMS, 250)).toBe(1000);
  });

  it("redondea al peso", () => {
    expect(
      calcularComision([{ id: "a", titulo: "x", cantidad: 1, precioUnitario: 333 }], 250)
    ).toBe(8);
  });

  it("con 0 puntos basicos da 0", () => {
    expect(calcularComision(ITEMS, 0)).toBe(0);
  });
});

describe("crearPreferencia", () => {
  it("devuelve el id y los links de pago", async () => {
    const { fn } = capturarCuerpo();
    const pref = await crearPreferencia({ ...BASE, fetch: fn });
    expect(pref).toEqual({
      id: "pref-1",
      initPoint: "https://mp/checkout",
      sandboxInitPoint: "https://mp/sandbox",
    });
  });

  it("manda los items, la referencia externa y las URLs", async () => {
    const { fn, cuerpos } = capturarCuerpo();
    await crearPreferencia({ ...BASE, fetch: fn });
    const cuerpo = cuerpos[0]!;
    expect(cuerpo.external_reference).toBe("P-123456");
    expect(cuerpo.notification_url).toBe(BASE.urlDeNotificacion);
    expect(cuerpo.back_urls).toEqual({
      success: BASE.urlsDeVuelta.exito,
      failure: BASE.urlsDeVuelta.error,
      pending: BASE.urlsDeVuelta.pendiente,
    });
    expect(cuerpo.auto_return).toBe("approved");
    expect(cuerpo.items).toHaveLength(2);
    expect((cuerpo.items as unknown[])[0]).toMatchObject({
      id: "sku-1",
      title: "Serum de niacinamida",
      quantity: 2,
      unit_price: 12000,
      currency_id: "ARS",
    });
  });

  it("CON comision manda application_fee calculado", async () => {
    const { fn, cuerpos } = capturarCuerpo();
    await crearPreferencia({ ...BASE, comisionEnPuntosBasicos: 250, fetch: fn });
    expect(cuerpos[0]!.application_fee).toBe(1000);
  });

  it("SIN comision NO manda application_fee: MP rechaza el valor 0", async () => {
    const { fn, cuerpos } = capturarCuerpo();
    await crearPreferencia({ ...BASE, comisionEnPuntosBasicos: 0, fetch: fn });
    expect("application_fee" in cuerpos[0]!).toBe(false);
  });

  it("sin comision declarada tampoco manda application_fee", async () => {
    const { fn, cuerpos } = capturarCuerpo();
    await crearPreferencia({ ...BASE, fetch: fn });
    expect("application_fee" in cuerpos[0]!).toBe(false);
  });

  it("una comision que redondea a 0 tampoco se manda", async () => {
    const { fn, cuerpos } = capturarCuerpo();
    await crearPreferencia({
      ...BASE,
      items: [{ id: "a", titulo: "x", cantidad: 1, precioUnitario: 10 }],
      comisionEnPuntosBasicos: 1,
      fetch: fn,
    });
    expect("application_fee" in cuerpos[0]!).toBe(false);
  });

  it("con vencimiento manda expires y la fecha en ISO", async () => {
    const { fn, cuerpos } = capturarCuerpo();
    const venceEn = new Date("2026-08-13T10:30:00.000Z");
    await crearPreferencia({ ...BASE, venceEn, fetch: fn });
    expect(cuerpos[0]!.expires).toBe(true);
    expect(cuerpos[0]!.expiration_date_to).toBe("2026-08-13T10:30:00.000Z");
  });

  it("sin vencimiento no manda expires", async () => {
    const { fn, cuerpos } = capturarCuerpo();
    await crearPreferencia({ ...BASE, venceEn: null, fetch: fn });
    expect("expires" in cuerpos[0]!).toBe(false);
  });

  it("rechaza una lista de items vacia antes de molestar a MP", async () => {
    const { fn, cuerpos } = capturarCuerpo();
    const error = await crearPreferencia({ ...BASE, items: [], fetch: fn }).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(ErrorMP);
    expect(cuerpos).toHaveLength(0);
  });

  it("si MP contesta sin init_point, es un error y no una preferencia a medias", async () => {
    const { fn } = capturarCuerpo({ id: "pref-1" });
    const error = await crearPreferencia({ ...BASE, fetch: fn }).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorMP);
  });

  it("sin sandbox_init_point en la respuesta, queda null", async () => {
    const { fn } = capturarCuerpo({ id: "pref-1", init_point: "https://mp/checkout" });
    const pref = await crearPreferencia({ ...BASE, fetch: fn });
    expect(pref.sandboxInitPoint).toBeNull();
  });

  it("un item con descripcion y categoria los manda; sin ellas, no", async () => {
    const { fn, cuerpos } = capturarCuerpo();
    await crearPreferencia({
      ...BASE,
      items: [{ id: "sku-1", titulo: "Serum", descripcion: "30ml", categoria: "skincare", cantidad: 1, precioUnitario: 12000 }],
      fetch: fn,
    });
    const item = (cuerpos[0]!.items as Record<string, unknown>[])[0]!;
    expect(item.description).toBe("30ml");
    expect(item.category_id).toBe("skincare");

    const { fn: fn2, cuerpos: cuerpos2 } = capturarCuerpo();
    await crearPreferencia({ ...BASE, fetch: fn2 });
    const itemSinExtra = (cuerpos2[0]!.items as Record<string, unknown>[])[0]!;
    expect("description" in itemSinExtra).toBe(false);
    expect("category_id" in itemSinExtra).toBe(false);
  });

  it("el pagador se manda solo con lo que se pasa: nombre, email, o ambos", async () => {
    const { fn, cuerpos } = capturarCuerpo();
    await crearPreferencia({ ...BASE, pagador: { nombre: "Juana" }, fetch: fn });
    expect(cuerpos[0]!.payer).toEqual({ name: "Juana" });

    const { fn: fn2, cuerpos: cuerpos2 } = capturarCuerpo();
    await crearPreferencia({ ...BASE, pagador: { email: "juana@x.com" }, fetch: fn2 });
    expect(cuerpos2[0]!.payer).toEqual({ email: "juana@x.com" });

    const { fn: fn3, cuerpos: cuerpos3 } = capturarCuerpo();
    await crearPreferencia({ ...BASE, fetch: fn3 });
    expect("payer" in cuerpos3[0]!).toBe(false);
  });

  it("con descriptorEnResumen, lo manda como statement_descriptor", async () => {
    const { fn, cuerpos } = capturarCuerpo();
    await crearPreferencia({ ...BASE, descriptorEnResumen: "BESTIE", fetch: fn });
    expect(cuerpos[0]!.statement_descriptor).toBe("BESTIE");
  });

  it("con metadata, la manda; sin ella, no", async () => {
    const { fn, cuerpos } = capturarCuerpo();
    await crearPreferencia({ ...BASE, metadata: { tenantId: "bestie" }, fetch: fn });
    expect(cuerpos[0]!.metadata).toEqual({ tenantId: "bestie" });

    const { fn: fn2, cuerpos: cuerpos2 } = capturarCuerpo();
    await crearPreferencia({ ...BASE, fetch: fn2 });
    expect("metadata" in cuerpos2[0]!).toBe(false);
  });
});
