import { sql } from "drizzle-orm";
import { loQueCambio, type CambioAuditoria } from "../lo-que-cambio.js";
import { CAMPOS_SENSIBLES_POR_DEFECTO, redactar } from "../redactar.js";
import { esClaveSensible, normalizarTerminos } from "../coincidencia-sensible.js";
import { serializarParaAuditoria } from "../serializar.js";
import type { DbCliente } from "./cliente.js";
import type { ActorTipo, TablaAuditoria } from "./tabla.js";

/** Lo que se audita. */
export interface EntradaAuditoria {
  tenantId: string;
  entidad: string;
  entidadId: string;
  /** Ej. `"crear"`, `"actualizar"`, `"anular"`. */
  accion: string;
  actor: { tipo: ActorTipo; id?: string };
  /** La foto completa de la entidad antes del cambio. Ausente = no se auditan `antes`/`despues`/`cambios` con datos (queda `[]` en `cambios`, `null` en `antes`/`despues`) — ej. un `"crear"`, donde no hay "antes". */
  antes?: unknown;
  /** La foto completa de la entidad después del cambio. Ausente en un `"anular"`/`"borrar"`, donde no hay "después". */
  despues?: unknown;
  ip?: string;
  userAgent?: string;
  /** Lista propia de campos sensibles a redactar; por defecto, `CAMPOS_SENSIBLES_POR_DEFECTO` de `@mafesoftware/auditoria`. */
  camposSensibles?: readonly string[];
}

export type ResultadoAuditar = { ok: true; id: string } | { ok: false; error: unknown };

/**
 * Defensa EN PROFUNDIDAD sobre `cambios` (el resultado de `loQueCambio`),
 * DESPUÉS de que `auditar` ya corrió `redactar` sobre `antes`/`despues`
 * ANTES de diffearlos (ver el JSDoc de `auditar`, sección "Cómo se evita
 * que un secreto anidado llegue a `cambios`"). En el flujo normal, esto casi
 * nunca encuentra nada que tapar — `antes`/`despues` ya llegan redactados
 * acá, así que cualquier valor bajo una clave sensible YA es
 * `"[redactado]"` antes de que `loQueCambio` lo vea. Se mantiene igual como
 * red de seguridad ante cualquier hueco no anticipado (ej. si algún día
 * `loQueCambio` cambia y deja de operar sobre el resultado de `redactar`).
 *
 * A diferencia de `redactar` (que tapa por NOMBRE DE CLAVE de un objeto),
 * acá el nombre del campo sensible vive como VALOR de `campo` (ej.
 * `{ campo: "token.access", antes: "abc", despues: "xyz" }`), no como
 * clave — así que correr `redactar` sobre el arreglo TAL CUAL no
 * alcanzaría: las claves de cada entrada son `"campo"`, `"antes"`,
 * `"despues"`, ninguna sensible por sí misma.
 *
 * Chequea CUALQUIER segmento de la ruta con puntos (no solo el último): si
 * `"token.access"` matchea porque `"token"` es sensible (aunque `"access"`
 * no lo sea), igual se tapa — la fuga original de este paquete (C1) era
 * justo eso, un ancestro sensible con un hijo de nombre inocuo.
 */
function redactarCambiosDefensaEnProfundidad(cambios: CambioAuditoria[], camposSensibles: readonly string[]): CambioAuditoria[] {
  const sensibles = normalizarTerminos(camposSensibles);
  return cambios.map((cambio) => {
    const tieneSegmentoSensible = cambio.campo.split(".").some((segmento) => esClaveSensible(segmento, sensibles));
    if (tieneSegmentoSensible) {
      return {
        campo: cambio.campo,
        antes: cambio.antes === undefined ? undefined : "[redactado]",
        despues: cambio.despues === undefined ? undefined : "[redactado]",
      };
    }
    return {
      campo: cambio.campo,
      antes: redactar(cambio.antes, camposSensibles),
      despues: redactar(cambio.despues, camposSensibles),
    };
  });
}

/**
 * Un resumen SEGURO de `error` para loguear: nunca el objeto de error
 * completo (que para un fallo de Postgres vía Drizzle es un
 * `DrizzleQueryError` que trae, como propiedades PROPIAS del objeto, el SQL
 * armado Y los PARÁMETROS bindeados — `console.error(mensaje, error)`
 * terminaría imprimiendo cada valor que se intentó insertar, secretos
 * redactados o sin redactar incluidos, en el log de la app). Solo
 * `code`/`message` del error de POSTGRES (`error.cause`, donde Drizzle deja
 * el error original del driver `pg` — nunca `error.query`/`error.params`
 * del wrapper, que ni siquiera se leen acá). El `message` de un error de
 * Postgres (`null value in column ... violates not-null constraint`, `new
 * row for relation ... violates check constraint ...`) describe la
 * RESTRICCIÓN que falló, nunca el VALOR que la violó (eso vive en
 * `DETAIL`, que tampoco se lee acá) — por eso es seguro de loguear.
 */
function resumenDeError(error: unknown): string {
  const causa = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const origen = causa && typeof causa === "object" ? causa : error && typeof error === "object" ? error : undefined;
  if (origen) {
    const code = "code" in origen ? (origen as { code?: unknown }).code : undefined;
    const message = "message" in origen ? (origen as { message?: unknown }).message : undefined;
    const partes = [
      typeof code === "string" || typeof code === "number" ? `code=${String(code)}` : undefined,
      typeof message === "string" ? `message=${message}` : undefined,
    ].filter((p): p is string => p !== undefined);
    if (partes.length > 0) return partes.join(", ");
  }
  return "error desconocido (sin code/message legibles)";
}

/**
 * Escribe una fila de auditoría: redacta `antes`/`despues`, calcula
 * `cambios` con `loQueCambio` SOBRE LO YA REDACTADO, serializa los tres, e
 * inserta.
 *
 * **Nunca tira.** Devuelve `{ ok: true, id } | { ok: false, error }` y, si
 * falla, además loguea un RESUMEN seguro con `console.error` (ver
 * `resumenDeError`: nunca el objeto de error completo, nunca sus
 * parámetros bindeados) — una falla de auditoría NO tiene que tirar abajo
 * la operación de negocio que la disparó (crear el pedido, cobrar la
 * factura, ...).
 *
 * **Cómo se evita que un secreto anidado llegue a `cambios`.** La primera
 * versión de esta función calculaba `cambios = loQueCambio(entrada.antes,
 * entrada.despues)` (los valores CRUDOS) y redactaba recién DESPUÉS, mirando
 * el último segmento de cada ruta (`"token.access"` → `"access"`, que no es
 * sensible) — un secreto ANIDADO bajo una clave ancestro sensible
 * (`{ token: { access: "AAA1" } }`, donde `"token"` sí es sensible pero
 * `"access"` no) llegaba a la base SIN TAPAR, con la ruta completa
 * `"token.access"` y el valor real. Fix estructural: ahora se redacta
 * `antes`/`despues` ENTEROS con `redactar` (que sí mira TODOS los
 * ancestros de la ruta, no solo el nombre final) ANTES de calcular
 * `cambios` — `loQueCambio` corre sobre los valores YA redactados, así que
 * nunca ve el secreto. La consecuencia (documentada, aceptada): si un
 * secreto CAMBIÓ de valor (`"AAA1"` → `"AAA2"`), como los dos quedan
 * `"[redactado]"` antes de diffear, `cambios` **no muestra que hubo un
 * cambio en absoluto** ahí — se prioriza no filtrar el secreto por sobre
 * mostrar que existió un cambio en un campo sensible. `redactarCambiosDefensaEnProfundidad`
 * (interna) queda como red de seguridad adicional sobre el resultado, por
 * si algún día `loQueCambio` deja de operar sobre lo ya redactado.
 *
 * **El trade-off de "nunca tira" adentro de una transacción.** Si `dbOTx`
 * es la `tx` de un `db.transaction(async (tx) => ...)` en curso, un
 * `INSERT` que falla (una columna que no entra, un check constraint,
 * cualquier error de Postgres) deja esa transacción ABORTADA — Postgres
 * rechaza cualquier sentencia posterior hasta el `ROLLBACK`, así que un
 * simple `try/catch` alrededor del `insert` NO alcanza: el catch atraparía
 * el error de auditoría, pero la transacción EXTERNA ya quedaría inservible
 * para el resto de las sentencias del flujo de negocio que la llamó.
 *
 * La solución es un `SAVEPOINT`: esta función SIEMPRE llama
 * `dbOTx.transaction(...)` para el `insert` — en Drizzle, llamar
 * `.transaction()` DENTRO de una transacción ya abierta (`tx.transaction()`
 * anidado) arma un `SAVEPOINT`/`RELEASE SAVEPOINT`/`ROLLBACK TO SAVEPOINT`
 * en vez de una transacción nueva. Si el `insert` falla, Drizzle hace
 * `ROLLBACK TO SAVEPOINT` (deshace SOLO el insert de auditoría) y
 * relanza el error, que esta función atrapa acá adentro — la transacción
 * EXTERNA sigue viva y puede seguir commiteando el resto de su trabajo.
 * Llamado con el `db` de nivel superior (no una `tx`), `.transaction()`
 * simplemente abre una transacción normal para el insert, con el mismo
 * resultado (nada persiste si falla).
 *
 * **Si tu app llama a `auditar` más de una vez DENTRO de la misma
 * transacción, hacelo con `await` secuencial, nunca `Promise.all`.** Cada
 * llamada abre su propio `SAVEPOINT` sobre la MISMA conexión/transacción
 * subyacente — dos `SAVEPOINT`/`RELEASE SAVEPOINT` concurrentes en la misma
 * sesión de Postgres (que es lo que produce un `Promise.all([auditar(tx,
 * ...), auditar(tx, ...)])`) pisan el estado de transacción del otro
 * (Postgres serializa comandos de UNA sesión, pero el `SAVEPOINT`
 * anidado que arma Drizzle no está pensado para dos llamadas en vuelo a la
 * vez sobre la misma `tx`) y el resultado es indefinido — puede tirar, o
 * peor, confundir qué `SAVEPOINT` libera cada una. `await` una antes de
 * llamar a la siguiente.
 *
 * **No soporta el driver `neon-http`** (`drizzle-orm/neon-http`, HTTP sin
 * estado, sin conexión persistente): ese driver no implementa
 * `db.transaction()` en absoluto (cada `execute` es su propio request HTTP
 * sin relación con el anterior), así que no hay SAVEPOINT posible — usar
 * `neon-serverless` (WebSocket, con conexión real) o `node-postgres` si tu
 * app necesita `auditar` dentro de una transacción.
 *
 * Con `antes` y `despues` ausentes, `cambios` queda `[]`.
 *
 * ```ts
 * import { auditar } from "@mafesoftware/auditoria/drizzle";
 *
 * const resultado = await auditar(db, auditoria, {
 *   tenantId,
 *   entidad: "producto",
 *   entidadId: productoId,
 *   accion: "actualizar",
 *   actor: { tipo: "usuario", id: usuarioId },
 *   antes: productoAnterior,
 *   despues: productoNuevo,
 * });
 * if (!resultado.ok) {
 *   // resultado.error ya se logueó (resumen seguro) con console.error; seguir igual, no relanzar.
 * }
 *
 * // Adentro de una transacción de negocio: si auditar falla, la tx externa
 * // sigue viva (SAVEPOINT). Más de una llamada: SIEMPRE con await secuencial.
 * await db.transaction(async (tx) => {
 *   await tx.update(productos).set({ precio: nuevoPrecio }).where(eq(productos.id, id));
 *   await auditar(tx, auditoria, { tenantId, entidad: "producto", entidadId: id, accion: "actualizar", actor: { tipo: "usuario", id: usuarioId } });
 *   // el update de arriba se commitea aunque auditar hubiera fallado
 * });
 * ```
 */
export async function auditar(
  dbOTx: DbCliente,
  tabla: TablaAuditoria,
  entrada: EntradaAuditoria,
): Promise<ResultadoAuditar> {
  try {
    const camposSensibles = entrada.camposSensibles ?? CAMPOS_SENSIBLES_POR_DEFECTO;

    // C1: redactar ANTES de diffear — ver el JSDoc de esta función, sección
    // "Cómo se evita que un secreto anidado llegue a cambios". `redactar`
    // ya devuelve `undefined` tal cual si `entrada.antes`/`entrada.despues`
    // son `undefined` (no hace falta un ternario acá).
    const antesRedactado = redactar(entrada.antes, camposSensibles);
    const despuesRedactado = redactar(entrada.despues, camposSensibles);

    const cambiosCrudos = loQueCambio(antesRedactado, despuesRedactado);
    const cambiosRedactados = redactarCambiosDefensaEnProfundidad(cambiosCrudos, camposSensibles);

    const antesListo = antesRedactado === undefined ? null : serializarParaAuditoria(antesRedactado);
    const despuesListo = despuesRedactado === undefined ? null : serializarParaAuditoria(despuesRedactado);
    const cambiosListos = serializarParaAuditoria(cambiosRedactados);

    // Los tres valores para las columnas `jsonb` se pasan como TEXTO
    // (`JSON.stringify`), nunca como el objeto/arreglo JS crudo. Dos
    // problemas distintos si no:
    // 1) El `sql` de Drizzle trata cualquier valor interpolado que sea un
    //    `Array.isArray` como una LISTA `(a, b, c)` (para poder escribir
    //    `IN (${arr})`) — `cambiosListos` SIEMPRE es un arreglo (aunque sea
    //    `[]`), así que terminaba armando `()` literal en el SQL (`42601`).
    // 2) Incluso evitando eso (`sql.param(...)`), el DRIVER `pg` tampoco
    //    sirve para un arreglo: su `prepareValue` interno trata cualquier
    //    JS `Array` como un ARRAY NATIVO de Postgres (`arrayString`, la
    //    sintaxis `{a,b,c}`), nunca como JSON — un arreglo de objetos
    //    terminaba viajando como `{"{\"campo\":...}"}` (un array-literal de
    //    Postgres con un string adentro), que `jsonb` rechaza con
    //    `22P02 invalid input syntax for type json`. Las dos fallas se
    //    reprodujeron corriendo los tests de Postgres de este paquete.
    //    `JSON.stringify` esquiva las dos: el valor que viaja es un
    //    `string` normal, y Postgres lo castea implícito a `jsonb` por el
    //    tipo de la columna destino (columna sin ambigüedad de tipo, a
    //    diferencia del `coalesce` de `configurarNumerador` en
    //    `@mafesoftware/numeradores/drizzle`, que sí necesita un cast
    //    EXPLÍCITO). `null` viaja tal cual (nunca el string `"null"`).
    const antesParametro = antesListo === null ? null : JSON.stringify(antesListo);
    const despuesParametro = despuesListo === null ? null : JSON.stringify(despuesListo);
    const cambiosParametro = JSON.stringify(cambiosListos);

    // INSERT armado con `sql`/`sql.identifier` (no `.insert(tabla).values()`
    // del query builder), mismo motivo que `siguienteNumero`/
    // `configurarNumerador` de `@mafesoftware/numeradores/drizzle`: el tipo
    // público `TablaAuditoria` (`PgTable & ColumnasAuditoria`) es un cast
    // ancho para que `auditar`/`listarAuditoria` acepten CUALQUIER tabla
    // armada con `tablaAuditoria` (distinta columna/tipo de tenant,
    // `columnasExtra` propias) sin repetir esos genéricos — pero por eso
    // mismo no trae la forma exacta que el query builder de Drizzle
    // necesita para tipar `.values()`/`.returning()` en tiempo de
    // compilación. SQL crudo con columnas por `sql.identifier(tabla.x.name)`
    // funciona igual sin importar el nombre real de cada columna.
    const colTenant = sql.identifier(tabla.tenantId.name);
    const colEntidad = sql.identifier(tabla.entidad.name);
    const colEntidadId = sql.identifier(tabla.entidadId.name);
    const colAccion = sql.identifier(tabla.accion.name);
    const colActorTipo = sql.identifier(tabla.actorTipo.name);
    const colActorId = sql.identifier(tabla.actorId.name);
    const colAntes = sql.identifier(tabla.antes.name);
    const colDespues = sql.identifier(tabla.despues.name);
    const colCambios = sql.identifier(tabla.cambios.name);
    const colIp = sql.identifier(tabla.ip.name);
    const colUserAgent = sql.identifier(tabla.userAgent.name);
    const colId = sql.identifier(tabla.id.name);

    // SIEMPRE a través de `.transaction()` (ver el JSDoc de arriba): sobre
    // `dbOTx` de nivel superior abre una transacción normal; sobre una `tx`
    // ya en curso, arma un SAVEPOINT — así un fallo acá nunca aborta una
    // transacción externa que ya estaba en curso.
    const fila = await dbOTx.transaction(async (tx) => {
      const consulta = sql`
        insert into ${tabla} (${colTenant}, ${colEntidad}, ${colEntidadId}, ${colAccion}, ${colActorTipo}, ${colActorId}, ${colAntes}, ${colDespues}, ${colCambios}, ${colIp}, ${colUserAgent})
        values (
          ${entrada.tenantId}, ${entrada.entidad}, ${entrada.entidadId}, ${entrada.accion}, ${entrada.actor.tipo}, ${entrada.actor.id ?? null},
          ${antesParametro}, ${despuesParametro}, ${cambiosParametro}, ${entrada.ip ?? null}, ${entrada.userAgent ?? null}
        )
        returning ${colId} as id
      `;
      const resultado = (await tx.execute(consulta)) as unknown as { rows: { id: string }[] };
      return resultado.rows[0];
    });

    if (!fila) {
      throw new Error("auditar: el INSERT no devolvió ninguna fila (no debería pasar)");
    }
    return { ok: true, id: fila.id };
  } catch (error) {
    // NUNCA `console.error(mensaje, error)`: `error` (o su `.cause`, si es
    // un `DrizzleQueryError`) puede traer, como propiedades PROPIAS, el SQL
    // armado y los PARÁMETROS bindeados — que incluyen cualquier dato que
    // se intentó insertar, redactado o no. Solo un resumen seguro
    // (`entidad`/`entidadId`/`accion` de la propia `entrada`, más
    // `code`/`message` de `resumenDeError`) va al log.
    console.error(
      `auditar: no se pudo escribir el registro de auditoría (entidad=${entrada.entidad}, entidadId=${entrada.entidadId}, accion=${entrada.accion}): ${resumenDeError(error)}`,
    );
    return { ok: false, error };
  }
}
