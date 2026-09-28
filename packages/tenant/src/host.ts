import { ErrorTenant } from "./errores.js";
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
 *
 * IPv6 entre corchetes (`"[::1]:3000"`) se reconoce como un bloque: el
 * puerto es lo que sigue al `"]"` de cierre, no lo que sigue al primer
 * `":"` — partir por `":"` a ciegas cortaría la dirección en pedazos y
 * devolvería solo `"["`.
 */
export function normalizarHost(host: string): string {
  let h = host.trim().toLowerCase();

  if (h.startsWith("[")) {
    const cierre = h.indexOf("]");
    h = cierre === -1 ? h : h.slice(0, cierre + 1); // "[::1]:3000" -> "[::1]" (deja el puerto afuera)
  } else {
    h = h.split(":")[0] ?? h; // saca el puerto ("demo.localhost:3300" -> "demo.localhost")
  }

  h = h.replace(/\.$/, ""); // saca UN punto final ("demo.mafe.app." -> "demo.mafe.app")
  if (h.startsWith("www.")) h = h.slice(4);
  return h;
}

/**
 * Un hostname válido: una o más etiquetas `[a-z0-9]` (con guiones en el
 * medio, nunca al borde) separadas por un punto. Ni esquema (`https://`),
 * ni path (`/`), ni wildcard (`*`), ni espacios — un `dominioBase` es
 * SIEMPRE un host pelado, nunca una URL.
 */
const HOSTNAME_VALIDO = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

/**
 * `dominioBase` normalizado igual que un host (mismas reglas de
 * `normalizarHost` — en particular, un `dominioBase = "www.mafe.app"` y uno
 * `= "mafe.app"` se tratan como el mismo dominio), y VALIDADO: un
 * `dominioBase` vacío, en blanco, que quede vacío después de normalizar
 * (`""`, `"  "`, `"."`), o que no sea un HOSTNAME (una URL con esquema como
 * `"https://x"`, algo con una barra como `"x/"`, un wildcard como `"*.x"`,
 * un valor con espacios en el medio, o cualquier otra cosa que no sea
 * `[a-z0-9-]` separado por puntos) es un error de PROGRAMACIÓN — la app que
 * llama a `slugDeHost`/`resolverTenant` no configuró bien su dominio, no es
 * un host que mandó alguien — así que tira `ErrorTenant` (`codigo:
 * "dominio_base_invalido"`) en vez de devolver `null` como el resto de las
 * validaciones de este archivo.
 *
 * El chequeo de esquema (`"://"`) va ANTES de `normalizarHost`: ese
 * normalizado saca todo lo que sigue al primer `":"` como si fuera un
 * puerto (`"https://x"` → `"https"`, que por sí solo SÍ parece un hostname
 * válido) — sin este chequeo previo, una URL con esquema se colaría.
 */
export function validarDominioBase(dominioBase: string): string {
  if (typeof dominioBase === "string" && dominioBase.includes("://")) {
    throw new ErrorTenant(
      "dominio_base_invalido",
      `dominioBase tiene que ser un hostname, no una URL con esquema: ${JSON.stringify(dominioBase)}`,
    );
  }
  const base = normalizarHost(dominioBase);
  if (!base || !HOSTNAME_VALIDO.test(base)) {
    throw new ErrorTenant("dominio_base_invalido", `dominioBase vacío o inválido (tiene que ser un hostname): ${JSON.stringify(dominioBase)}`);
  }
  return base;
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
 * - un slug reservado (`reservados`, por defecto `RESERVADOS`; una lista
 *   propia con mayúsculas se normaliza sola — ver `validarSlug`);
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
 *
 * Tira `ErrorTenant` si `dominioBase` es inválido (ver
 * `validarDominioBase`) — es la única situación en la que esta función
 * tira en vez de devolver `null`.
 */
export function slugDeHost(
  host: string,
  dominioBase: string,
  reservados: ReadonlySet<string> = RESERVADOS,
): string | null {
  const h = normalizarHost(host);
  if (h.endsWith(".vercel.app")) return null;

  const base = validarDominioBase(dominioBase);
  const sufijo = `.${base}`;
  if (!h.endsWith(sufijo)) return null; // cubre la apex y cualquier host que no sea de esta base

  const slug = h.slice(0, -sufijo.length);
  if (!slug || slug.includes(".")) return null; // vacío (no debería pasar) o subdominio de más de un nivel
  if (slug.startsWith("xn--")) return null; // punycode: no es un slug nuestro

  const resultado = validarSlug(slug, reservados);
  return resultado.ok ? resultado.slug : null;
}
