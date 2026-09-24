import { slugDeHost, validarDominioBase } from "./host.js";
import { RESERVADOS } from "./reservados.js";

/**
 * Las búsquedas y la configuración que necesita `resolverTenant`, inyectadas
 * por la app: este paquete no sabe qué motor de base usa cada producto
 * (Drizzle, Prisma, postgres.js...), así que no consulta nada — solo
 * orquesta el resultado de dos búsquedas que ya hizo otro código.
 */
export interface OpcionesResolverTenant {
  /**
   * El host de la request, TAL CUAL llega (sin normalizar a mano: de eso se
   * encarga `slugDeHost` adentro) — típicamente
   * `headers.get("x-forwarded-host") ?? headers.get("host")`. `null` si no
   * hay uno (script, cron, seed).
   */
  host: string | null;
  /** El dominio de la plataforma bajo el que cuelgan los subdominios de organización (ver `slugDeHost`). */
  dominioBase: string;
  /** Slugs que ningún host puede resolver. Por defecto `RESERVADOS`. */
  reservados?: ReadonlySet<string>;
  /** El id de tenant que trae la sesión (cookie/JWT), o `null` si no hay sesión. */
  sesion: string | null;
  /** Resuelve el id de tenant a partir del SLUG del host (ya extraído por esta función). `null` si ese slug no es de ninguna organización. */
  buscarPorSlug: (slug: string) => Promise<string | null>;
  /** Resuelve/confirma el id de tenant a partir del valor de sesión. `null` si no resuelve a uno válido. */
  buscarPorSesion: (sesion: string) => Promise<string | null>;
}

/**
 * De qué organización es esta request, cruzando host y sesión.
 *
 * Hay DOS fuentes y ninguna sola alcanza: el host da la dirección pública
 * (`demo.mafe.app`), la sesión da de qué organización es la persona
 * logueada. Cuando las dos hablan, TIENEN que coincidir:
 *
 * - host y sesión resuelven al MISMO id → esa organización.
 * - host y sesión resuelven a ids DISTINTOS → `null`. Esto es lo que evita
 *   que la cookie de sesión de una organización sirva en la dirección de
 *   otra — sin este chequeo, alguien logueado en `a.mafe.app` que entra a
 *   `b.mafe.app` vería los datos de `b` con SU sesión de `a`.
 * - solo el host resuelve → la organización del host (páginas públicas, sin
 *   login).
 * - solo la sesión resuelve (el host es la apex, un dominio desconocido, o
 *   no hay host) → `null`, **no** la organización de la sesión. Nunca hay
 *   una organización "por defecto": eso sería mostrarle a quien entra por
 *   una URL sin organización los datos de la última con la que inició
 *   sesión, en el dominio equivocado.
 * - ninguna resuelve → `null`.
 *
 * El host nunca llega directo a `buscarPorSlug`: primero se lo convierte en
 * SLUG con `slugDeHost(host, dominioBase, reservados)`, así que un host en
 * mayúsculas, con puerto, un dominio reservado, `*.vercel.app` o un
 * subdominio de más de un nivel nunca llegan a la búsqueda inyectada — ya
 * los filtró `slugDeHost` antes.
 *
 * `dominioBase` se valida con `validarDominioBase` ANTES de tocar cualquier
 * búsqueda, incluso sin host: si está vacío o en blanco tira `ErrorTenant`
 * (error de programación — la app no configuró su dominio — no un dato de
 * la request).
 *
 * Puro en el sentido de "no toca la base": las dos búsquedas están
 * inyectadas. Se corren en paralelo porque son independientes. **Fail
 * closed**: si `buscarPorSlug`/`buscarPorSesion` tiran (por ejemplo, la base
 * no responde), el error se propaga tal cual — nunca se lo atrapa para
 * devolver `null` en su lugar, porque eso confundiría "esta organización no
 * existe" con "no pudimos preguntar".
 */
export async function resolverTenant(opciones: OpcionesResolverTenant): Promise<string | null> {
  const { host, dominioBase, reservados = RESERVADOS, sesion, buscarPorSlug, buscarPorSesion } = opciones;

  // Se valida SIEMPRE, incluso sin host: un dominioBase mal configurado es
  // un bug que tiene que aparecer apenas se llama a la función, no solo el
  // día que además llega un host.
  validarDominioBase(dominioBase);

  const slug = host ? slugDeHost(host, dominioBase, reservados) : null;

  const [porHost, porSesion] = await Promise.all([
    slug ? buscarPorSlug(slug) : Promise.resolve(null),
    sesion ? buscarPorSesion(sesion) : Promise.resolve(null),
  ]);

  if (porHost && porSesion) {
    return porHost === porSesion ? porHost : null;
  }
  if (porHost) return porHost;

  // Solo la sesión resolvió (o ninguna): sin organización por defecto.
  return null;
}
