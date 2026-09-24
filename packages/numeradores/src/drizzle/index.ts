/**
 * Lo específico de Drizzle: la tabla de numeradores y las dos operaciones
 * atómicas que la usan. Subpath separado porque `drizzle-orm` es un
 * peerDependency opcional — el núcleo (`@mafesoftware/numeradores`) no lo
 * necesita y no lo importa.
 *
 * Este paquete NO trae migraciones (spec 06 §3.2): cada app genera las
 * suyas con drizzle-kit a partir de su propio esquema, que usa
 * `tablaNumeradores`. Ver `sql/ejemplo.sql` para el DDL equivalente, de
 * referencia para consumidores sin Drizzle.
 *
 * - `tabla.ts`: `tablaNumeradores`.
 * - `siguiente-numero.ts`: `siguienteNumero` (exige transacción).
 * - `configurar-numerador.ts`: `configurarNumerador`.
 * - `cliente.ts` / `transaccion.ts`: internos (el tipo `DbCliente` y la
 *   detección de transacción), no se re-exportan acá.
 *
 * Ejemplo completo:
 *
 * ```ts
 * import { tablaNumeradores, siguienteNumero, configurarNumerador } from "@mafesoftware/numeradores/drizzle";
 *
 * export const numeradores = tablaNumeradores();
 *
 * await configurarNumerador(db, numeradores, { tenantId, tipo: "recibo", prefijo: "R-", relleno: 4 });
 *
 * const { numero, formateado } = await db.transaction((tx) =>
 *   siguienteNumero(tx, numeradores, { tenantId, tipo: "recibo" }),
 * );
 * // formateado: "R-0001", "R-0002", ... sin huecos ni repetidos aunque
 * // muchas transacciones lo pidan a la vez.
 * ```
 */
export { tablaNumeradores, type OpcionesTablaNumeradores, type ColumnasNumeradores, type TablaNumeradores } from "./tabla.js";
export { siguienteNumero, type OpcionesSiguienteNumero, type ResultadoSiguienteNumero } from "./siguiente-numero.js";
export { configurarNumerador, type OpcionesConfigurarNumerador } from "./configurar-numerador.js";
export type { DbCliente } from "./cliente.js";
