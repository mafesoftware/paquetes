import { describe, expect, it } from "vitest";
import { botonCorreo, escapeHtml, plantillaCorreo } from "../src/index.js";

describe("escapeHtml", () => {
  it("neutraliza lo que podría convertirse en una etiqueta", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'fin'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#039;fin&#039;"
    );
  });
});

describe("plantillaCorreo", () => {
  it("la marca y el pie entran ESCAPADOS; el cuerpo, tal cual", () => {
    const html = plantillaCorreo({
      marca: { nombre: "Bestie <K-Beauty>", bajada: "Piel & rutina" },
      cuerpoHtml: "<h1>Hola</h1>",
      pie: "Escribinos a <duenia>",
    });
    expect(html).toContain("Bestie &lt;K-Beauty&gt;");
    expect(html).toContain("Piel &amp; rutina");
    expect(html).toContain("<h1>Hola</h1>");
    expect(html).toContain("Escribinos a &lt;duenia&gt;");
  });

  it("el color de la marca pinta el encabezado, y sin bajada no hay renglón vacío", () => {
    const html = plantillaCorreo({
      marca: { nombre: "Bestie", colorFondo: "#5c1f30" },
      cuerpoHtml: "<p>Hola</p>",
    });
    expect(html).toContain("background:#5c1f30");
    expect(html).not.toContain("rgba(255,255,255,.75)");
  });
});

describe("botonCorreo", () => {
  it("escapa la URL y el texto: una comilla no puede cerrar el atributo", () => {
    const html = botonCorreo('https://x.com/?a="b"', "Ver <pedido>", "#5c1f30");
    expect(html).toContain("https://x.com/?a=&quot;b&quot;");
    expect(html).toContain("Ver &lt;pedido&gt;");
    expect(html).toContain("background:#5c1f30");
  });
});
