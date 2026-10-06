import { describe, expect, it } from "vitest";
import { rangoDeDias, rangoHorario } from "../src/index.ts";

describe("rangoDeDias", () => {
  it("un día o el rango de días", () => {
    expect(rangoDeDias("2026-11-14", null)).toBe("14/11/26");
    expect(rangoDeDias("2026-11-14", undefined)).toBe("14/11/26");
    expect(rangoDeDias("2026-11-14", "2026-11-14")).toBe("14/11/26");
    expect(rangoDeDias("2026-11-14", "2026-11-16")).toBe("14/11/26 al 16/11/26");
  });
  it("usa el formateador de la app si se lo pasa", () => {
    expect(rangoDeDias("2026-11-14", "2026-11-16", (d) => d.split("-").reverse().join("/"))).toBe("14/11/2026 al 16/11/2026");
  });
});

describe("rangoHorario", () => {
  it("avisa cuando cruza la medianoche", () => {
    expect(rangoHorario("20:00:00", "23:30:00")).toBe("20:00 a 23:30");
    expect(rangoHorario("21:00:00", "04:00:00")).toBe("21:00 a 04:00 (+1 día)");
    expect(rangoHorario("21:00", "21:00")).toBe("21:00 a 21:00");
  });
  it("con un solo extremo o ninguno", () => {
    expect(rangoHorario("21:00:00", null)).toBe("desde las 21:00");
    expect(rangoHorario(null, "04:00")).toBe("hasta las 04:00");
    expect(rangoHorario(null, undefined)).toBeNull();
  });
});
