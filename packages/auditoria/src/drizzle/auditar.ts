import { sql } from "drizzle-orm";
import { loQueCambio, type CambioAuditoria } from "../lo-que-cambio.js";
import { CAMPOS_SENSIBLES_POR_DEFECTO, redactar } from "../redactar.js";
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

/** El último segmento de una ruta con puntos (`"direccion.cbu"` -> `"cbu"`) — el nombre de campo real que hay que chequear contra la lista de sensibles. */
function ultimoSegmento(ruta: string): string {
  const i = ruta.lastIndexOf(".");
  return i === -1 ? ruta : ruta.slice(i + 1);
}

function normalizarClave(clave: string): string {
  return clave.toLowerCase().replace(/[_-]/g, "");
}

/**
 * Redacta el resultado de `loQueCambio` — a diferencia de `redactar`, que
 * tapa por NOMBRE DE CLAVE de un objeto, acá el nombre del campo sensible
 * vive como VALOR de `campo` (ej. `{ campo: "contrasena", antes: "abc",
 * despues: "xyz" }`), no como clave — así que correr `redactar` sobre el
 * arreglo TAL CUAL no alcanzaría: las claves de cada entrada son `"campo"`,
 * `"antes"`, `"despues"`, ninguna sensible por sí misma, y el VALOR
 * sensible de verdad quedaría sin tapar bajo la clave `"antes"`/`"despues"`.
 *
 * Si el ÚLTIMO segmento de la ruta (`"direccion.cbu"` -> `"cbu"`) matchea
 * la lista, se reemplaza el valor entero por `"[redactado]"` (conservando
 * `undefined` si el campo estaba ausente de ese lado). Si no matchea, igual
 * se corre `redactar` sobre `antes`/`despues` por si son objetos con
 * alguna clave sensible ADENTRO — ej. un campo `"direccion"` reemplazado
 * entero por un objeto nuevo que tiene un `token` propio.
 */
function redactarCambios(cambios: CambioAuditoria[], camposSensibles: readonly string[]): CambioAuditoria[] {
  const sensibles = new Set(camposSensibles.map(normalizarClave));
  return cambios.map((cambio) => {
    if (sensibles.has(normalizarClave(ultimoSegmento(cambio.campo)))) {
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
 * Escribe una fila de auditoría: calcula `cambios` con `loQueCambio(antes,
 * despues)`, redacta y serializa `antes`/`despues`/`cambios`, e inserta.
 *
 * **Nunca tira.** Devuelve `{ ok: true, id } | { ok: false, error }` y, si
 * falla, además loguea con `console.error` — una falla de auditoría NO
 * tiene que tirar abajo la operación de negocio que la disparó (crear el
 * pedido, cobrar la factura, ...).
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
 *   // resultado.error ya se logueó con console.error; seguir igual, no relanzar.
 * }
 *
 * // Adentro de una transacción de negocio: si auditar falla, la tx externa
 * // sigue viva (SAVEPOINT).
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
    const camposSensibles = entrada.camposSensibles;
    const cambiosCrudos = loQueCambio(entrada.antes, entrada.despues);

    const antesListo =
      entrada.antes === undefined ? null : serializarParaAuditoria(redactar(entrada.antes, camposSensibles));
    const despuesListo =
      entrada.despues === undefined ? null : serializarParaAuditoria(redactar(entrada.despues, camposSensibles));
    const cambiosListos = serializarParaAuditoria(
      redactarCambios(cambiosCrudos, camposSensibles ?? CAMPOS_SENSIBLES_POR_DEFECTO),
    );

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
    console.error(
      `auditar: no se pudo escribir el registro de auditoría (${entrada.entidad} ${entrada.entidadId}, accion=${entrada.accion}):`,
      error,
    );
    return { ok: false, error };
  }
}
