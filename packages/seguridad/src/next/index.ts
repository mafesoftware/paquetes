/**
 * Lo específico de Next.js: CSP con nonce, cabeceras de seguridad, auth de
 * cron y el `guard()` de server actions. Subpath separado porque `next` es
 * un peerDependency opcional — el núcleo (`@mafesoftware/seguridad`) no lo
 * necesita y no lo importa.
 *
 * - `csp.ts`: `politicaCsp`, `generarNonce`.
 * - `cabeceras.ts`: `cabecerasSeguridad`.
 * - `cron.ts`: `autorizarCron`.
 * - `guard.ts`: `guard`, `ErrorNegocio`.
 * - `ip.ts`: `ipDe`.
 */
export { politicaCsp, generarNonce, type ExtrasCsp } from "./csp.js";
export { cabecerasSeguridad } from "./cabeceras.js";
export { autorizarCron } from "./cron.js";
export { guard, ErrorNegocio, type ResultadoGuard } from "./guard.js";
export { ipDe } from "./ip.js";
