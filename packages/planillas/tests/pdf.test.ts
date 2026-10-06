import { describe, expect, it } from "vitest";
import { textoWinAnsi } from "../src/index.ts";

describe("textoWinAnsi", () => {
  it("conserva Latin-1 y la puntuación tipográfica de WinAnsi", () => {
    expect(textoWinAnsi("Año ¿Señal? º “citas” — 10 € • ok…")).toBe("Año ¿Señal? º “citas” — 10 € • ok…");
  });

  it("le saca el diacrítico a lo que no es Latin-1 y reemplaza lo imposible por un espacio", () => {
    expect(textoWinAnsi("Erdős")).toBe("Erdos");
    expect(textoWinAnsi("Fiesta 🎉 ok")).toBe("Fiesta   ok");
    expect(textoWinAnsi("a\tb")).toBe("a b");
  });
});
