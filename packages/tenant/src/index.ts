/**
 * Resolución de tenant (organización) para los productos multi-tenant de
 * MAFE Software: de qué organización es una request, qué subdominio le
 * corresponde, y qué slugs no puede tomar una organización nueva.
 *
 * Núcleo puro: no lee variables de entorno, no toca ninguna base ni framework — las
 * búsquedas (`resolverTenant`) y el dominio base (`slugDeHost`) entran por
 * parámetro. Lo específico de Drizzle (la FK compuesta que impide que un
 * hijo apunte al padre de otra organización) vive en el subpath
 * `@mafesoftware/tenant/drizzle`, que NO se importa desde acá (`drizzle-orm`
 * es un peerDependency opcional solo de ese subpath).
 *
 * - `host.ts`: `normalizarHost`, `slugDeHost`, `validarDominioBase`.
 * - `reservados.ts`: `RESERVADOS`.
 * - `validar-slug.ts`: `validarSlug`.
 * - `resolver.ts`: `resolverTenant`.
 * - `contexto.ts`: `conTenant`, `tenantDelContexto` (`AsyncLocalStorage`).
 * - `errores.ts`: `ErrorTenant`, el único error que tira este paquete.
 */
export { normalizarHost, slugDeHost, validarDominioBase } from "./host.js";
export { RESERVADOS } from "./reservados.js";
export { validarSlug, type MotivoSlugInvalido, type ResultadoValidarSlug } from "./validar-slug.js";
export { resolverTenant, type OpcionesResolverTenant } from "./resolver.js";
export { conTenant, tenantDelContexto } from "./contexto.js";
export { ErrorTenant, type CodigoErrorTenant } from "./errores.js";
