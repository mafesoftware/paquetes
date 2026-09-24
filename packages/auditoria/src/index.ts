/**
 * Registro de auditoría inmutable y por tenant: qué cambió (diff de
 * antes/después), quién, cuándo, con campos sensibles redactados.
 *
 * - `lo-que-cambio.ts`: `loQueCambio` — el diff entre dos versiones de una
 *   entidad, en rutas con puntos, determinístico y a prueba de ciclos.
 * - `redactar.ts`: `redactar`/`CAMPOS_SENSIBLES_POR_DEFECTO` — tapa por
 *   nombre de clave (`contrasena`, `cbu`, `token`, ...), a cualquier
 *   profundidad.
 * - `serializar.ts`: `serializarParaAuditoria` — deja un valor listo para
 *   `jsonb` (bigint → string con sufijo `"n"`, Date → ISO, undefined se
 *   descarta), sin tirar nunca.
 * - `normalizar-para-diff.ts`: `normalizarParaDiff` — las mismas reglas de
 *   tipos especiales que `serializarParaAuditoria`, pero SIN redactar; para
 *   correr `loQueCambio` sobre datos ya normalizados (dos instancias
 *   distintas con el mismo valor semántico no deberían verse "cambiadas").
 *   Su resultado NUNCA se guarda ni se loguea: no redacta.
 * - `redactar-cambios.ts`: `redactarCambios` — la redacción del resultado
 *   de `loQueCambio` por segmento de ruta (la que usa `auditar`).
 *
 * Núcleo puro: sin variables de entorno, sin framework, sin base de datos.
 * Lo específico de Drizzle (la tabla, el trigger de inmutabilidad, y las
 * funciones que escriben/leen contra Postgres) vive en el subpath
 * `@mafesoftware/auditoria/drizzle`, que NO se importa desde acá
 * (`drizzle-orm` es un peerDependency opcional solo de ese subpath).
 */
export { loQueCambio, type CambioAuditoria } from "./lo-que-cambio.js";
export { redactar, CAMPOS_SENSIBLES_POR_DEFECTO } from "./redactar.js";
export { PROFUNDIDAD_MAXIMA } from "./tipos-especiales.js";
export { serializarParaAuditoria } from "./serializar.js";
export { normalizarParaDiff } from "./normalizar-para-diff.js";
export { redactarCambios } from "./redactar-cambios.js";
