/**
 * Harness de aislamiento entre tenants para los productos multi-tenant de
 * MAFE Software: dado un registro de casos (qué operación probar) y una
 * función `sembrar` que arma dos tenants aislados A y B, corre cada caso
 * COMO TENANT B contra un id que pertenece a A y clasifica el resultado (o la
 * excepción) como "filtra" o "no encontrado" — que es lo único que un tenant
 * ajeno puede ver sin que sea una fuga.
 *
 * Núcleo puro: `probarAislamiento` no sabe nada de vitest ni de una base en
 * particular — `sembrar`, `ejecutar` y `esNoEncontrado` los inyecta la app
 * consumidora. El helper que registra un `it` por caso vive en el subpath
 * `@mafesoftware/pruebas-tenant/vitest` (`vitest` como peerDependency
 * opcional, solo ahí).
 */
export {
  probarAislamiento,
  type CasoAislamiento,
  type OpcionesProbarAislamiento,
  type ResultadoAislamiento,
} from './probar-aislamiento.js';
