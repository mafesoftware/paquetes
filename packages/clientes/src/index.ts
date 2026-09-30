/**
 * Validación de documento (DNI/CUIT) y normalización para detectar
 * duplicados (email/teléfono/documento) de clientes o prospectos —
 * extraído de Obriq (spec 10 §1.7 y §1.6, "advertencia y sugerencia de
 * fusión").
 *
 * Núcleo puro: sin DB ni framework. `@mafesoftware/documentos-ar` hace el
 * trabajo de validación de CUIT/DNI en sí (dígito verificador); este
 * paquete solo compone.
 *
 * - `validarDocumentoCliente`: valida y normaliza un DNI o un CUIT.
 * - `normalizarTelefono`/`esMismoTelefono`: comparación de teléfonos
 *   argentinos ignorando prefijos (país, celular, discado local).
 * - `normalizarDni`/`normalizarEmail`: normalización simple para comparar
 *   duplicados por esos campos.
 *
 * La fusión en sí (mover cuenta corriente/reservas/prospectos del
 * perdedor al ganador y archivar al perdedor con un puntero) es lógica
 * transaccional atada a la DB de cada app — no hay parte pura de eso para
 * extraer acá; ver el README.
 */
export { validarDocumentoCliente, type TipoDocumentoCliente, type ResultadoDocumentoCliente } from './documento.js';
export { normalizarTelefono, esMismoTelefono, normalizarDni, normalizarEmail } from './duplicados.js';
