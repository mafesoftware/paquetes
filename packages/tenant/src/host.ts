import { RESERVADOS } from "./reservados.js";
import { validarSlug } from "./validar-slug.js";

/**
 * El host de una request, limpio: minúsculas, sin puerto, sin el punto
 * final (un host DNS válido pero raro: `"demo.mafe.app."`) y sin el
 * `"www."` de adelante.
 *
 * `www.demo.mafe.app` y `demo.mafe.app` tienen que ser EL MISMO host para
 * todo lo de acá adentro — si no, alguien que entra por `www` (algo que un
 * navegador agrega solo si el usuario lo tipea) ve una organización
 * distinta, o ninguna.
 */
export function normalizarHost(host: string): string {
  let h = host.trim().toLowerCase();
  h = h.split(":")[0] ?? h; // saca el puerto ("demo.localhost:3300" -> "demo.localhost")
  h = h.replace(/\.$/, ""); // saca UN punto final ("demo.mafe.app." -> "demo.mafe.app")
  if (h.startsWith("www.")) h = h.slice(4);
  return h;
}

/**
 * El slug de organización que pide este host bajo `dominioBase`, o `null`
 * si el host no es un subdominio válido de una organización.
 *
 * `null` para:
 * - el dominio pelado (`"mafe.app"` con `dominioBase = "mafe.app"`): la
 *   apex no es de ninguna organización;
 * - un subdominio de más de un nivel (`"panel.demo.mafe.app"`): un slug es
 *   SIEMPRE una sola etiqueta;
 * - un slug reservado (`reservados`, por defecto `RESERVADOS`);
 * - `*.vercel.app`: cada preview de Vercel trae su propio host único, y
 *   ninguno es una organización real;
 * - punycode (`xn--...`): un host así viene de un dominio internacionalizado
 *   escrito con caracteres no-ASCII, nunca de un slug que haya creado la
 *   plataforma (los slugs son ASCII por diseño — ver `validarSlug`);
 * - cualquier etiqueta que no pase `validarSlug` (largo, caracteres,
 *   guiones de borde/dobles).
 *
 * Funciona con `dominioBase = "localhost"` (`"demo.localhost:3300"` →
 * `"demo"`), que es como se prueban los subdominios en E2E sin DNS.
 */
export function slugDeHost(
  host: string,
  dominioBase: string,
  reservados: ReadonlySet<string> = RESERVADOS,
): string | null {
  const h = normalizarHost(host);
  if (h.endsWith(".vercel.app")) return null;

  const base = normalizarHost(dominioBase);
  const sufijo = `.${base}`;
  if (!h.endsWith(sufijo)) return null; // cubre la apex y cualquier host que no sea de esta base

  const slug = h.slice(0, -sufijo.length);
  if (!slug || slug.includes(".")) return null; // vacío (no debería pasar) o subdominio de más de un nivel
  if (slug.startsWith("xn--")) return null; // punycode: no es un slug nuestro

  const resultado = validarSlug(slug, reservados);
  return resultado.ok ? resultado.slug : null;
}
