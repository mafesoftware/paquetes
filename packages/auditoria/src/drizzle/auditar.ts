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

/**
 * El motivo SANITIZADO de un fallo de `auditar` — nunca el error crudo de
 * Drizzle/`pg` (que puede traer, como propiedades propias, el SQL armado y
 * los parámetros bindeados). Ver el JSDoc de `auditar`.
 */
export interface ErrorAuditoria {
  /** El código de error de Postgres (ej. `"23514"`), tomado de `error.cause`. `null` si `auditar` no pudo determinarlo. */
  codigo: string | null;
  /** El mensaje de Postgres (nunca el SQL armado ni los parámetros bindeados) — o un texto genérico fijo si no se pudo determinar uno seguro. */
  mensaje: string;
}

export type ResultadoAuditar = { ok: true; id: string } | { ok: false; error: ErrorAuditoria };

/**
 * Redacta `cambios` (el resultado de `loQueCambio` sobre los valores
 * CRUDOS — ver el JSDoc de `auditar`, sección "Cómo se evita que un
 * secreto llegue a `cambios`").
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
 * no lo sea), el VALOR entero de esa entrada se reemplaza por
 * `"[redactado]"` en cada lado que esté DEFINIDO — un lado `undefined`
 * (típico de un alta/baja: no había "antes", o no queda "despues") se deja
 * `undefined`, para no fingir que había un valor ahí. Para un cambio que
 * NO tiene ningún segmento sensible en su ruta, igual se corre `redactar`
 * sobre cada lado (`antes`/`despues` pueden ser objetos, arreglos,
 * instancias, `Map`s o `Set`s con una clave sensible ADENTRO — ej. un
 * arreglo de objetos donde cambió un `password` en algún elemento).
 */
function redactarCambios(cambios: CambioAuditoria[], camposSensibles: readonly string[]): CambioAuditoria[] {
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
 * Un mensaje que NUNCA contiene "Failed query"/"params:" — el patrón exacto
 * que arma un `DrizzleQueryError` para su PROPIO `.message` (el SQL armado
 * seguido de los parámetros bindeados). Un mensaje de Postgres real (el que
 * sí interesa, desde `error.cause`) nunca tiene estas frases — esto es
 * además una segunda red, no la única defensa: `resumenDeError` NUNCA lee
 * `.message` del error de afuera, solo de `error.cause`.
 */
function mensajeSeguro(mensaje: string): string | undefined {
  if (mensaje.includes("Failed query") || mensaje.includes("params:")) return undefined;
  return mensaje;
}

/** El texto fijo que usan `errorSeguro`/el log cuando no hay un mensaje seguro que mostrar. */
const MENSAJE_GENERICO = "error de base de datos sin detalle";

/**
 * Un resumen SEGURO de `error` — nunca el objeto de error completo, y nunca
 * — ni siquiera como fallback — `error.message`/`error.code` del error de
 * AFUERA. Para un fallo de Postgres vía Drizzle, `error` es un
 * `DrizzleQueryError` cuyo PROPIO `.message` es justamente `"Failed query:
 * <sql>\nparams: <valores bindeados>"` — leerlo (aunque fuera como último
 * recurso, cuando `error.cause` faltara) filtraría el SQL armado y cada
 * parámetro, exactamente lo que esta función existe para evitar. Por eso:
 * SOLO `code`/`message` de `error.cause` (donde Drizzle deja el error
 * original del driver `pg`) — nunca `error.query`/`error.params` del
 * wrapper, que ni siquiera se leen acá. `codigo` queda `null` si no se
 * pudo determinar; `mensaje` cae al texto genérico fijo `MENSAJE_GENERICO`
 * si no hay uno seguro (ausente, o filtrado por `mensajeSeguro` porque
 * traía "Failed query"/"params:"). El `message` de un error de Postgres
 * (`null value in column ... violates not-null constraint`, `new row for
 * relation ... violates check constraint ...`) describe la RESTRICCIÓN que
 * falló, nunca el VALOR que la violó (eso vive en `DETAIL`, que tampoco se
 * lee acá) — por eso es seguro de devolver/loguear.
 *
 * Esta es la MISMA función que arma tanto el resumen que se loguea con
 * `console.error` como el `ErrorAuditoria` que `auditar` devuelve en
 * `{ ok: false, error }` — las dos superficies tienen que ser igual de
 * seguras, así que comparten la lógica de extracción en vez de cada una
 * mirando el error por su cuenta.
 */
function errorSeguro(error: unknown): ErrorAuditoria {
  const causa = error && typeof error === "object" && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  const causaObjeto = causa && typeof causa === "object" ? causa : undefined;

  const codeCrudo = causaObjeto && "code" in causaObjeto ? (causaObjeto as { code?: unknown }).code : undefined;
  const codigo = typeof codeCrudo === "string" || typeof codeCrudo === "number" ? String(codeCrudo) : null;

  const messageCruda = causaObjeto && "message" in causaObjeto ? (causaObjeto as { message?: unknown }).message : undefined;
  const mensajeCrudo = typeof messageCruda === "string" ? mensajeSeguro(messageCruda) : undefined;

  return { codigo, mensaje: mensajeCrudo ?? MENSAJE_GENERICO };
}

/** El texto que se loguea con `console.error` para un `ErrorAuditoria` — `"code=X, message=Y"`, o solo `Y` si no hay código. */
function textoParaLog(error: ErrorAuditoria): string {
  return error.codigo !== null ? `code=${error.codigo}, message=${error.mensaje}` : error.mensaje;
}

/**
 * Escribe una fila de auditoría: calcula `cambios` con `loQueCambio` sobre
 * los valores CRUDOS de `entrada.antes`/`entrada.despues`, redacta
 * `antes`/`despues`/`cambios`, serializa los tres, e inserta.
 *
 * **Nunca tira.** Devuelve `{ ok: true, id } | { ok: false, error }` y, si
 * falla, además loguea un RESUMEN seguro con `console.error` — una falla
 * de auditoría NO tiene que tirar abajo la operación de negocio que la
 * disparó (crear el pedido, cobrar la factura, ...).
 *
 * **`resultado.error` (cuando `ok: false`) es `{ codigo: string | null;
 * mensaje: string }` — un `ErrorAuditoria` SANITIZADO, nunca el error
 * crudo de Drizzle/`pg`.** Antes, esta función devolvía el error tal cual
 * lo atrapaba — pero para un fallo de Postgres vía Drizzle, ese error es
 * un `DrizzleQueryError` que trae, como propiedad PROPIA (`.message`), el
 * SQL armado seguido de los parámetros bindeados (`"Failed query:
 * <sql>\nparams: <valores>"`) — devolverlo tal cual era, en la práctica,
 * devolver el SQL y los datos insertados a quien llamó a `auditar`, con el
 * riesgo de que ese código lo logueara o lo mostrara sin saber que traía
 * eso adentro. Ahora `codigo`/`mensaje` se arman con la MISMA función
 * (`errorSeguro`, interna) que usa el log: `codigo` es el `code` de
 * Postgres (ej. `"23514"`) tomado de `error.cause` — `null` si no se pudo
 * determinar — y `mensaje` es el `message` de Postgres (nunca el `.message`
 * del wrapper) o un texto genérico fijo si no hay uno seguro. El SQL
 * armado y los parámetros bindeados NUNCA aparecen en ninguno de los dos
 * campos. Esto significa que ya no hace falta armar un resumen propio para
 * mostrar/loguear el motivo de un fallo — `resultado.error` ya es seguro
 * para eso.
 *
 * **Cómo se evita que un secreto (cambiado o no) llegue a `cambios`.**
 * `cambios` se calcula con `loQueCambio` sobre los valores CRUDOS de
 * `entrada.antes`/`entrada.despues` — NO sobre versiones ya redactadas — y
 * recién DESPUÉS se redacta el resultado (`redactarCambios`, interna),
 * mirando CUALQUIER segmento de la ruta con puntos (`"token.access"` →
 * `["token", "access"]`), no solo el último. Si algún segmento es sensible
 * (`"token"` lo es, aunque `"access"` no), el VALOR ENTERO de esa entrada
 * se reemplaza por `"[redactado]"` en cada lado que esté definido — nunca
 * el valor real, pero **sí queda registrado que ese campo CAMBIÓ**: antes
 * de este fix, redactar `antes`/`despues` ENTEROS antes de diffear hacía
 * que los dos lados llegaran a `loQueCambio` como el MISMO string
 * `"[redactado]"`, y un cambio real en un campo sensible desaparecía de
 * `cambios` por completo (no solo el valor: la SEÑAL de que hubo un
 * cambio). Para un cambio SIN ningún segmento sensible en su ruta, cada
 * lado se redacta igual con `redactar` — cubre el caso de un arreglo
 * cambiado ENTERO (`loQueCambio` compara arreglos como valor completo, no
 * por índice) que tiene, adentro, un objeto con una clave sensible.
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
 *   // resultado.error ya se logueó (resumen seguro) con console.error;
 *   // seguir igual, no relanzar. resultado.error ya es seguro de mostrar:
 *   // resultado.error.codigo ("23514" | null), resultado.error.mensaje
 *   // (nunca el SQL/los parámetros).
 * }
 *
 * // Un campo sensible que CAMBIÓ queda registrado (sin el valor real):
 * await auditar(db, auditoria, {
 *   tenantId, entidad: "usuario", entidadId, accion: "actualizar", actor: { tipo: "usuario" },
 *   antes: { password: "A" }, despues: { password: "B" },
 * });
 * // cambios: [{ campo: "password", antes: "[redactado]", despues: "[redactado]" }]
 * // (se sabe que "password" cambió, nunca a qué)
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

    // N1: el diff se calcula sobre los valores CRUDOS — ver el JSDoc de
    // esta función, sección "Cómo se evita que un secreto (cambiado o no)
    // llegue a cambios". `cambiosCrudos` NUNCA se serializa ni se guarda
    // tal cual: se redacta acá abajo (`redactarCambios`) antes de tocar la
    // base.
    const cambiosCrudos = loQueCambio(entrada.antes, entrada.despues);
    const cambiosParaGuardar = redactarCambios(cambiosCrudos, camposSensibles);

    // Las fotos completas `antes`/`despues` (columnas separadas de
    // `cambios`) se redactan por su cuenta — `redactar` ya devuelve
    // `undefined` tal cual si `entrada.antes`/`entrada.despues` son
    // `undefined` (no hace falta un ternario acá).
    const antesRedactado = redactar(entrada.antes, camposSensibles);
    const despuesRedactado = redactar(entrada.despues, camposSensibles);

    const antesListo = antesRedactado === undefined ? null : serializarParaAuditoria(antesRedactado);
    const despuesListo = despuesRedactado === undefined ? null : serializarParaAuditoria(despuesRedactado);
    const cambiosListos = serializarParaAuditoria(cambiosParaGuardar);

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
    // NUNCA `console.error(mensaje, error)` ni `return { ok: false, error }`
    // con el error CRUDO: `error` (o su `.cause`, si es un
    // `DrizzleQueryError`) puede traer, como propiedades PROPIAS, el SQL
    // armado y los PARÁMETROS bindeados — que incluyen cualquier dato que
    // se intentó insertar, redactado o no. `errorSeguro` arma la MISMA
    // versión sanitizada para las dos superficies (el log y el valor
    // devuelto): solo `code`/`message` de `error.cause`.
    const errorParaDevolver = errorSeguro(error);
    console.error(
      `auditar: no se pudo escribir el registro de auditoría (entidad=${entrada.entidad}, entidadId=${entrada.entidadId}, accion=${entrada.accion}): ${textoParaLog(errorParaDevolver)}`,
    );
    return { ok: false, error: errorParaDevolver };
  }
}
