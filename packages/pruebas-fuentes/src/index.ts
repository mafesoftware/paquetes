/**
 * Detectores de reglas de código fuente para los productos de MAFE Software:
 * cosas que, si se olvidan, no rompen nada visible (la pantalla anda, el
 * typecheck pasa) y el problema aparece en producción o no aparece nunca —
 * simplemente deja la puerta abierta. Pensado para correr DENTRO de un test
 * de vitest de la app consumidora, al estilo `tests/fuentes.test.ts` de
 * gestionflow: cada detector es una fábrica con sus opciones, se corre con
 * `correrDetectores(archivos, detectores)` sobre los fuentes ya leídos, y se
 * afirma que no hay hallazgos.
 *
 * Heurísticas por regex/tokens sobre el texto — no un parser de TypeScript.
 * Documentado con su política de falsos positivos/negativos en cada
 * detector y en el README ("## Política de falsos positivos/negativos").
 *
 * Núcleo puro: `correrDetectores` y cada detector trabajan sobre
 * `{ ruta; texto }[]` ya en memoria, sin tocar disco. `leerArchivos` es la
 * ÚNICA función Node-only del paquete (usa `node:fs`) — ver su doc.
 */
export type { ArchivoFuente, Detector, Hallazgo } from './tipos.js';
export {
  correrDetectores,
  guardaEnUseServer,
  serverOnlyEnDatos,
  sinCoalesceCeroEnPlata,
  sinDependenciaFile,
  sinImportDeDatosEnCliente,
  sinSetHours,
  sinSqlCrudoConOr,
  type OpcionesGuardaEnUseServer,
  type OpcionesServerOnlyEnDatos,
  type OpcionesSinCoalesceCeroEnPlata,
  type OpcionesSinImportDeDatosEnCliente,
} from './detectores.js';
export { leerArchivos } from './leer-archivos.js';
