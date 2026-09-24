import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { normalizarHost, slugDeHost } from "../src/host.js";
import { validarSlug } from "../src/validar-slug.js";
import { RESERVADOS } from "../src/reservados.js";

const BASE = "mafe.app";

/** Una etiqueta de slug: solo `[a-z0-9]`, sin guiones (los agrega el `join` de abajo). */
const ETIQUETA = fc
  .array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789".split("")), { minLength: 1, maxLength: 8 })
  .map((letras) => letras.join(""));

/**
 * Slugs válidos y no reservados: juntar etiquetas con un solo "-" nunca
 * produce guion al borde ni doble guion (las etiquetas no tienen guiones
 * propios), así que solo hace falta filtrar por largo, punycode y
 * reservados para que cada uno sea un slug que `validarSlug` acepta.
 */
const SLUG_VALIDO = fc
  .array(ETIQUETA, { minLength: 1, maxLength: 5 })
  .map((partes) => partes.join("-"))
  .filter((s) => s.length >= 3 && s.length <= 40 && !s.startsWith("xn--") && !RESERVADOS.has(s));

describe("propiedades: slugDeHost / normalizarHost", () => {
  it("slugDeHost(normalizarHost(`${slug}.${base}`), base) siempre devuelve el mismo slug, para todo slug válido y no reservado", () => {
    fc.assert(
      fc.property(SLUG_VALIDO, (slug) => {
        const host = `${slug}.${BASE}`;
        expect(slugDeHost(normalizarHost(host), BASE)).toBe(slug);
      }),
    );
  });

  it("lo mismo vale sin normalizar antes (slugDeHost normaliza internamente)", () => {
    fc.assert(
      fc.property(SLUG_VALIDO, fc.boolean(), (slug, mayusculas) => {
        const host = mayusculas ? `${slug}.${BASE}`.toUpperCase() : `${slug}.${BASE}`;
        expect(slugDeHost(host, BASE)).toBe(slug);
      }),
    );
  });

  it("todo slug que slugDeHost acepta, validarSlug también lo acepta (son la misma noción de slug válido)", () => {
    fc.assert(
      fc.property(SLUG_VALIDO, (slug) => {
        const host = `${slug}.${BASE}`;
        const deHost = slugDeHost(host, BASE);
        expect(deHost).not.toBeNull();
        if (deHost) {
          expect(validarSlug(deHost)).toEqual({ ok: true, slug: deHost });
        }
      }),
    );
  });
});

/**
 * Un host "razonable": etiquetas DNS separadas por punto, con mayúsculas al
 * azar, puerto opcional, punto final opcional y `www.` opcional adelante —
 * exactamente lo que `normalizarHost` documenta que sabe limpiar. No se usa
 * `fc.webAuthority()` (userinfo, IPv6, unicode...) porque eso prueba un
 * contrato más amplio que el que `normalizarHost` dice tener.
 */
const HOST_RAZONABLE = fc
  .tuple(
    fc.array(ETIQUETA, { minLength: 1, maxLength: 4 }),
    fc.boolean(), // www. adelante
    fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }), // puerto
    fc.boolean(), // punto final
    fc.boolean(), // mayúsculas
  )
  .map(([etiquetas, conWww, puerto, conPuntoFinal, mayusculas]) => {
    let h = etiquetas.join(".");
    if (conWww) h = `www.${h}`;
    if (conPuntoFinal) h = `${h}.`;
    if (puerto !== undefined) h = `${h}:${puerto}`;
    return mayusculas ? h.toUpperCase() : h;
  });

describe("propiedades: normalizarHost es idempotente", () => {
  it("normalizarHost(normalizarHost(host)) === normalizarHost(host)", () => {
    fc.assert(
      fc.property(HOST_RAZONABLE, (host) => {
        const una = normalizarHost(host);
        expect(normalizarHost(una)).toBe(una);
      }),
    );
  });
});
