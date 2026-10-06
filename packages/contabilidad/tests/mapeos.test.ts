import { describe, expect, it } from "vitest";
import { calcularFaltantes, CLAVE, CLAVES_OTROS, resolverCuenta, siguienteCodigoSubcuenta } from "../src/mapeos.js";

describe("CLAVE", () => {
  it("arma cada clave parametrizada con el prefijo correcto", () => {
    expect(CLAVE.caja("caja-1")).toBe("caja:caja-1");
    expect(CLAVE.tipoOperacion("tipo-1")).toBe("tipo_operacion:tipo-1");
    expect(CLAVE.rubro("rubro-1")).toBe("rubro:rubro-1");
    expect(CLAVE.item("item-1")).toBe("item:item-1");
    expect(CLAVE.ivaVentas("21")).toBe("iva_ventas:21");
    expect(CLAVE.ivaVentas(21)).toBe("iva_ventas:21");
    expect(CLAVE.ivaCompras("10.5")).toBe("iva_compras:10.5");
    expect(CLAVE.retencionSufrida("ganancias")).toBe("retencion_sufrida:ganancias");
    expect(CLAVE.retencionPracticada("ganancias")).toBe("retencion_practicada:ganancias");
    expect(CLAVE.percepcionPracticada("caba")).toBe("percepcion_practicada:caba");
    expect(CLAVE.venta("alquiler")).toBe("venta:alquiler");
    expect(CLAVE.tarjeta("visa")).toBe("tarjeta:visa");
  });

  it("percepcionSufrida incluye la jurisdicción solo si se pasa", () => {
    expect(CLAVE.percepcionSufrida("iibb")).toBe("percepcion_sufrida:iibb");
    expect(CLAVE.percepcionSufrida("iibb", "caba")).toBe("percepcion_sufrida:iibb:caba");
  });
});

describe("resolverCuenta", () => {
  it("devuelve la cuenta mapeada directamente", () => {
    const resultado = resolverCuenta({ [CLAVE.item("item-1")]: "cuenta-materiales" }, CLAVE.item("item-1"));
    expect(resultado).toBe("cuenta-materiales");
  });

  it("ítem sin mapeo usa el de su rubro (fallback)", () => {
    const mapeos = { [CLAVE.rubro("rubro-1")]: "cuenta-costo-estructura" };
    const resultado = resolverCuenta(mapeos, CLAVE.item("item-1"), CLAVE.rubro("rubro-1"));
    expect(resultado).toBe("cuenta-costo-estructura");
  });

  it("sin mapeo directo ni de fallback → FaltaMapeo", () => {
    const resultado = resolverCuenta({}, CLAVE.rubro("rubro-1"));
    expect(typeof resultado).toBe("object");
    expect(resultado).toEqual({ clave: "rubro:rubro-1", descripcion: expect.stringContaining("rubro:rubro-1") });
  });
});

describe("calcularFaltantes", () => {
  it("rubro sin mapeo y sin fallback → FaltaMapeo con descripción 'Rubro 03 Estructura H°A° no tiene cuenta de costo'", () => {
    const resultado = calcularFaltantes({
      cajas: [],
      tiposOperacion: [],
      rubros: [{ id: "rubro-1", codigo: "03", nombre: "Estructura H°A°" }],
      mapeos: {},
    });
    expect(resultado.rubrosSinCuenta).toEqual([{ clave: "rubro:rubro-1", descripcion: "Rubro 03 Estructura H°A° no tiene cuenta de costo." }]);
  });

  it("caja nueva creada después → aparece en 'cajas sin cuenta'", () => {
    const cajaVieja = { id: "caja-vieja", nombre: "Caja pesos", moneda: "ARS" as const };
    const cajaNueva = { id: "caja-nueva", nombre: "Banco USD", moneda: "USD" as const };
    const resultado = calcularFaltantes({
      cajas: [cajaVieja, cajaNueva],
      tiposOperacion: [],
      rubros: [],
      mapeos: { [CLAVE.caja(cajaVieja.id)]: "cuenta-caja-vieja" },
    });
    expect(resultado.cajasSinCuenta).toEqual([{ clave: "caja:caja-nueva", descripcion: `Caja "Banco USD" no tiene cuenta asignada.` }]);
  });

  it("tipo de operación nuevo → aparece en 'tipos sin cuenta'", () => {
    const resultado = calcularFaltantes({
      cajas: [],
      tiposOperacion: [{ id: "tipo-1", nombre: "Cobro" }],
      rubros: [],
      mapeos: {},
    });
    expect(resultado.tiposSinCuenta).toEqual([{ clave: "tipo_operacion:tipo-1", descripcion: `Tipo de operación "Cobro" no tiene cuenta asignada.` }]);
  });

  it("claves fijas sin mapear aparecen en 'otros' (todas las de CLAVES_OTROS)", () => {
    const resultado = calcularFaltantes({ cajas: [], tiposOperacion: [], rubros: [], mapeos: {} });
    expect(resultado.otros.map((f) => f.clave)).toEqual([...CLAVES_OTROS]);
  });

  it("con todo mapeado, 0 faltantes (4 cajas y 25 rubros)", () => {
    const cajas = Array.from({ length: 4 }, (_, i) => ({ id: `caja-${i}`, nombre: `Caja ${i}`, moneda: "ARS" as const }));
    const rubros = Array.from({ length: 25 }, (_, i) => ({ id: `rubro-${i}`, codigo: String(i).padStart(2, "0"), nombre: `Rubro ${i}` }));
    const mapeos: Record<string, string> = {};
    for (const c of cajas) mapeos[CLAVE.caja(c.id)] = "cuenta-costo";
    for (const r of rubros) mapeos[CLAVE.rubro(r.id)] = "cuenta-costo";

    const resultado = calcularFaltantes({ cajas, tiposOperacion: [], rubros, mapeos });
    expect(resultado.cajasSinCuenta).toEqual([]);
    expect(resultado.rubrosSinCuenta).toEqual([]);
  });
});

describe("siguienteCodigoSubcuenta", () => {
  it("primera subcuenta bajo un prefijo vacío", () => {
    expect(siguienteCodigoSubcuenta([], "1.1.1")).toBe("1.1.1.01");
  });

  it("sigue la numeración de las ya existentes", () => {
    expect(siguienteCodigoSubcuenta(["1.1.1", "1.1.1.01", "1.1.1.02"], "1.1.1")).toBe("1.1.1.03");
  });

  it("no confunde un prefijo con otro que empieza igual", () => {
    expect(siguienteCodigoSubcuenta(["1.1.1.01", "1.1.10.01"], "1.1.1")).toBe("1.1.1.02");
  });
});
