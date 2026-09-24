/**
 * Las búsquedas que necesita `resolverTenant`, inyectadas por la app: este
 * paquete no sabe qué motor de base usa cada producto (Drizzle, Prisma,
 * postgres.js...), así que no consulta nada — solo orquesta el resultado de
 * dos búsquedas que ya hizo otro código.
 */
export interface OpcionesResolverTenant {
  /** El host de la request ya normalizado, o `null` si no hay uno (script, cron, seed). */
  host: string | null;
  /** El id de tenant que trae la sesión (cookie/JWT), o `null` si no hay sesión. */
  sesion: string | null;
  /** Resuelve el id de tenant a partir del host. `null` si ese host no es de ninguna organización. */
  buscarPorHost: (host: string) => Promise<string | null>;
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
 * Puro en el sentido de "no toca la base": las dos búsquedas están
 * inyectadas. Se corren en paralelo porque son independientes.
 */
export async function resolverTenant(opciones: OpcionesResolverTenant): Promise<string | null> {
  const { host, sesion, buscarPorHost, buscarPorSesion } = opciones;

  const [porHost, porSesion] = await Promise.all([
    host ? buscarPorHost(host) : Promise.resolve(null),
    sesion ? buscarPorSesion(sesion) : Promise.resolve(null),
  ]);

  if (porHost && porSesion) {
    return porHost === porSesion ? porHost : null;
  }
  if (porHost) return porHost;

  // Solo la sesión resolvió (o ninguna): sin organización por defecto.
  return null;
}
