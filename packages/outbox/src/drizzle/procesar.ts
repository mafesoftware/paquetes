import { sql } from "drizzle-orm";
import { backoff } from "../backoff.js";
import { clasificarResultado, type ResultadoTransporte } from "../clasificar-resultado.js";
import { ErrorOutbox } from "../errores.js";
import type { CanalOutbox } from "../tipos.js";
import type { Transporte } from "../transporte.js";
import type { DbCliente } from "./cliente.js";
import type { TablaOutbox } from "./tabla.js";

/** Opciones de `procesarOutbox`. */
export interface OpcionesProcesarOutbox {
  /** El `db` de nivel superior (NO una `tx`) — `procesarOutbox` abre sus propias transacciones cortas, una para reclamar el lote y una por fila para registrar el resultado. */
  db: DbCliente;
  tabla: TablaOutbox;
  /** Un `Transporte` por canal. Un canal sin `Transporte` configurado descarta sus mensajes con `categoria: "credenciales"` (ver el JSDoc más abajo). */
  transportes: { correo?: Transporte; whatsapp?: Transporte };
  /** Cuántas filas reclamar como máximo por corrida. `20` por defecto. Entero `>= 1`. */
  lote?: number;
  /** De dónde sale "ahora" — inyectable para tests deterministas. `() => new Date()` por defecto. */
  ahora?: () => Date;
  /** Cuánto dura el lease de una fila reclamada antes de considerarse "colgada" y quedar disponible para que otro worker la reclame de nuevo. `600_000` (10 min) por defecto. `> 0`. */
  leaseMs?: number;
}

/** Resumen de una corrida de `procesarOutbox`. */
export interface ResumenProcesarOutbox {
  /** Cuántas filas se reclamaron en esta corrida (incluye las que venían `"pendiente"` y las `"procesando"` con el lease vencido). */
  reclamados: number;
  enviados: number;
  /** Fallo transitorio, todavía con intentos disponibles: quedó `"pendiente"` de nuevo, agendada con `backoff`. */
  reintentar: number;
  /** Fallo transitorio que agotó `maxIntentos`: quedó `"fallido"`, no se reintenta más. */
  fallidos: number;
  /** Fallo permanente (o canal sin `Transporte` configurado): quedó `"descartado"` sin gastar reintentos. */
  descartados: number;
}

/** Una fila ya reclamada (estado `"procesando"`, `intentos` ya incrementado), tal como la devuelve `reclamarLote`. */
interface FilaReclamada {
  id: string;
  tenantId: string;
  canal: CanalOutbox;
  destino: string;
  plantilla: string;
  datos: unknown;
  intentos: number;
  maxIntentos: number;
}

const RESUMEN_VACIO: ResumenProcesarOutbox = { reclamados: 0, enviados: 0, reintentar: 0, fallidos: 0, descartados: 0 };

/**
 * Procesa hasta `lote` mensajes debidos de la cola: los reclama de forma
 * atómica (`FOR UPDATE SKIP LOCKED`, a salvo de que otro `procesarOutbox`
 * concurrente — otra instancia del cron, o dos corridas superpuestas —
 * mande el mismo mensaje dos veces), llama al `Transporte` de cada canal, y
 * registra el resultado.
 *
 * **Dos fases, con transacciones DISTINTAS a propósito:**
 *
 * 1. **Reclamo** (una transacción corta): `WITH candidatos AS (SELECT ...
 *    FOR UPDATE SKIP LOCKED) UPDATE ... RETURNING ...` — en una sola
 *    sentencia, marca hasta `lote` filas como `"procesando"`, les fija
 *    `bloqueado_hasta = ahora() + leaseMs` e incrementa `intentos` en 1.
 *    Candidatas: `"pendiente"` con `programado_para`/`proximo_intento_en`
 *    ya cumplidos, MÁS `"procesando"` cuyo `bloqueado_hasta` ya venció (un
 *    worker anterior se cayó a mitad de camino sin terminar de registrar el
 *    resultado — se reclama de nuevo, y por eso también cuenta como un
 *    intento más). `SKIP LOCKED` es lo que hace que dos `procesarOutbox`
 *    concurrentes se REPARTAN el trabajo en vez de pisarse: mientras una
 *    transacción tiene una fila bloqueada, la otra directamente no la ve
 *    como candidata, no espera ni falla. Esta fase es TAN CORTA como sea
 *    posible (nada de llamadas de red adentro) para no tener el lock más
 *    tiempo del necesario.
 * 2. **Envío y registro** (fuera de esa transacción, una transacción corta
 *    POR FILA para el `UPDATE` final): llama al `Transporte` del canal de
 *    cada fila reclamada, y guarda el resultado. Deliberadamente FUERA de
 *    la transacción de reclamo: una llamada de red a Resend/Kapso puede
 *    tardar segundos, y tenerla adentro de la misma transacción que hizo el
 *    `FOR UPDATE` mantendría esas filas bloqueadas (y esa conexión
 *    ocupada) todo ese tiempo, sin necesidad.
 *
 * **Un canal sin `Transporte` configurado** (`transportes.correo`/
 * `transportes.whatsapp` ausente) descarta sus mensajes con `categoria:
 * "credenciales"`, `codigo: "transporte_no_configurado"` — mismo
 * tratamiento que credenciales faltantes de `transporteWhatsApp`: es un
 * problema de DESPLIEGUE (falta configurar el cron), no algo que un
 * reintento resuelva por sí solo.
 *
 * **Nunca tira por un fallo de transporte**: si el `Transporte` de un canal
 * TIRA (en vez de devolver `{ ok: false, ... }` como promete su contrato),
 * `procesarOutbox` atrapa la excepción y la trata como `"transitorio"` (sin
 * loguear el error — puede traer datos del destinatario) — un `Transporte`
 * que no respeta su contrato no puede dejar sin procesar al RESTO de las
 * filas del lote. **Esto NO cubre un fallo de la base** (la transacción de
 * reclamo, o el `UPDATE` que registra un resultado): si Postgres no
 * responde, `procesarOutbox` SÍ propaga esa excepción — no hay forma
 * segura de "tratar como transitorio" un fallo del que ni siquiera se sabe
 * si la fila quedó reclamada.
 *
 * Devuelve un resumen `{ reclamados, enviados, reintentar, fallidos,
 * descartados }` — `reclamados === 0` (nada debido en este momento) es el
 * caso más común en un cron que corre cada minuto.
 *
 * ```ts
 * import { procesarOutbox, transporteCorreo, transporteWhatsApp } from "@mafesoftware/outbox/drizzle";
 *
 * const resumen = await procesarOutbox({
 *   db,
 *   tabla: outbox,
 *   transportes: {
 *     correo: transporteCorreo({ remitente, enviar, render }),
 *     whatsapp: transporteWhatsApp({ credencialesDe, enviar: enviarPlantillaAdaptado }),
 *   },
 *   lote: 50,
 * });
 * // { reclamados: 12, enviados: 10, reintentar: 1, fallidos: 0, descartados: 1 }
 * ```
 */
export async function procesarOutbox(opciones: OpcionesProcesarOutbox): Promise<ResumenProcesarOutbox> {
  const lote = opciones.lote ?? 20;
  if (!Number.isInteger(lote) || lote < 1) {
    throw new ErrorOutbox("opciones_invalidas", `procesarOutbox: "lote" tiene que ser un entero >= 1 (fue ${lote}).`);
  }
  const leaseMs = opciones.leaseMs ?? 10 * 60 * 1000;
  if (!(leaseMs > 0)) {
    throw new ErrorOutbox("opciones_invalidas", `procesarOutbox: "leaseMs" tiene que ser > 0 (fue ${leaseMs}).`);
  }
  if (opciones.transportes.correo !== undefined && typeof opciones.transportes.correo !== "function") {
    throw new ErrorOutbox("opciones_invalidas", 'procesarOutbox: "transportes.correo" (si se pasa) tiene que ser una función.');
  }
  if (opciones.transportes.whatsapp !== undefined && typeof opciones.transportes.whatsapp !== "function") {
    throw new ErrorOutbox("opciones_invalidas", 'procesarOutbox: "transportes.whatsapp" (si se pasa) tiene que ser una función.');
  }
  const ahora = opciones.ahora ?? (() => new Date());

  const momento = ahora();
  const reclamados = await opciones.db.transaction((tx) => reclamarLote(tx, opciones.tabla, lote, momento, leaseMs));

  if (reclamados.length === 0) return RESUMEN_VACIO;

  const resumen: ResumenProcesarOutbox = { reclamados: reclamados.length, enviados: 0, reintentar: 0, fallidos: 0, descartados: 0 };

  await Promise.all(
    reclamados.map(async (fila) => {
      const resultado = await intentarTransporte(opciones.transportes, fila);
      const desenlace = await registrarResultado(opciones.db, opciones.tabla, fila, resultado, ahora());
      resumen[desenlace] += 1;
    }),
  );

  return resumen;
}

/**
 * La consulta de reclamo: un único `WITH ... SELECT ... FOR UPDATE SKIP
 * LOCKED` (candidatos) + `UPDATE ... FROM candidatos` (marca y devuelve).
 * Ver el JSDoc de `procesarOutbox` para el porqué de cada pieza.
 *
 * **Pensada para `READ COMMITTED`** (el aislamiento default de Postgres, y
 * el que usa `db.transaction(...)` si no se pide otro) — el mismo
 * aislamiento para el que están pensadas `siguienteNumero`/`configurarNumerador`
 * de `@mafesoftware/numeradores/drizzle`. Bajo `READ COMMITTED`, `FOR
 * UPDATE SKIP LOCKED` alcanza sola para el reparto entre workers
 * concurrentes: una segunda transacción que llega mientras la primera
 * todavía tiene filas bloqueadas simplemente las excluye de su propia
 * selección (no espera, no falla) — no hace falta `SERIALIZABLE` ni
 * `conReintento` alrededor de esta consulta.
 */
async function reclamarLote(
  tx: DbCliente,
  tabla: TablaOutbox,
  lote: number,
  momento: Date,
  leaseMs: number,
): Promise<FilaReclamada[]> {
  const colId = sql.identifier(tabla.id.name);
  const colEstado = sql.identifier(tabla.estado.name);
  const colTenant = sql.identifier(tabla.tenantId.name);
  const colCanal = sql.identifier(tabla.canal.name);
  const colDestino = sql.identifier(tabla.destino.name);
  const colPlantilla = sql.identifier(tabla.plantilla.name);
  const colDatos = sql.identifier(tabla.datos.name);
  const colIntentos = sql.identifier(tabla.intentos.name);
  const colMaxIntentos = sql.identifier(tabla.maxIntentos.name);
  const colProgramadoPara = sql.identifier(tabla.programadoPara.name);
  const colProximoIntentoEn = sql.identifier(tabla.proximoIntentoEn.name);
  const colBloqueadoHasta = sql.identifier(tabla.bloqueadoHasta.name);
  const colActualizadoEn = sql.identifier(tabla.actualizadoEn.name);

  const bloqueadoHastaNuevo = new Date(momento.getTime() + leaseMs);

  const consulta = sql`
    with candidatos as (
      select ${colId} as id
      from ${tabla}
      where (
        ${colEstado} = 'pendiente'
        and ${colProgramadoPara} <= ${momento}::timestamptz
        and (${colProximoIntentoEn} is null or ${colProximoIntentoEn} <= ${momento}::timestamptz)
      ) or (
        ${colEstado} = 'procesando'
        and ${colBloqueadoHasta} is not null
        and ${colBloqueadoHasta} < ${momento}::timestamptz
      )
      order by coalesce(${colProximoIntentoEn}, ${colProgramadoPara}) asc
      limit ${lote}
      for update skip locked
    )
    update ${tabla}
    set
      ${colEstado} = 'procesando',
      ${colBloqueadoHasta} = ${bloqueadoHastaNuevo}::timestamptz,
      ${colIntentos} = ${tabla}.${colIntentos} + 1,
      ${colActualizadoEn} = now()
    from candidatos
    where ${tabla}.${colId} = candidatos.id
    returning
      ${tabla}.${colId} as id,
      ${tabla}.${colTenant} as "tenantId",
      ${tabla}.${colCanal} as canal,
      ${tabla}.${colDestino} as destino,
      ${tabla}.${colPlantilla} as plantilla,
      ${tabla}.${colDatos} as datos,
      ${tabla}.${colIntentos} as intentos,
      ${tabla}.${colMaxIntentos} as "maxIntentos"
  `;

  const resultado = (await tx.execute(consulta)) as unknown as { rows: FilaReclamada[] };
  return resultado.rows;
}

/**
 * Llama al `Transporte` del canal de `fila`. Nunca tira: un canal sin
 * `Transporte` configurado, o un `Transporte` que TIRA en vez de devolver
 * `{ ok: false, ... }`, dan un `ResultadoTransporte` — nunca se propaga
 * ni se loguea el error crudo (puede traer datos del destinatario).
 */
async function intentarTransporte(
  transportes: { correo?: Transporte; whatsapp?: Transporte },
  fila: FilaReclamada,
): Promise<ResultadoTransporte> {
  const transporte = transportes[fila.canal];
  if (!transporte) {
    return { ok: false, categoria: "credenciales", codigo: "transporte_no_configurado" };
  }
  try {
    return await transporte({
      id: fila.id,
      tenantId: fila.tenantId,
      canal: fila.canal,
      destino: fila.destino,
      plantilla: fila.plantilla,
      datos: fila.datos,
    });
  } catch {
    // "red" (transitorio, ver clasificarResultado): un Transporte que tira
    // no distingue por sí solo si el problema es de red o de otra cosa, y
    // tratarlo como transitorio es la opción segura (ver el JSDoc de
    // clasificarResultado) — nunca se pierde un mensaje real por un bug de
    // un Transporte que no respeta su contrato de "nunca tira".
    return { ok: false, categoria: "red", codigo: "transporte_excepcion" };
  }
}

type Desenlace = "enviados" | "reintentar" | "fallidos" | "descartados";

/** Registra el resultado de un intento en la fila `fila`, en su propia transacción corta. Devuelve la clave del resumen a incrementar. */
async function registrarResultado(
  db: DbCliente,
  tabla: TablaOutbox,
  fila: FilaReclamada,
  resultado: ResultadoTransporte,
  momento: Date,
): Promise<Desenlace> {
  const colId = sql.identifier(tabla.id.name);
  const colEstado = sql.identifier(tabla.estado.name);
  const colIdExterno = sql.identifier(tabla.idExterno.name);
  const colEnviadoEn = sql.identifier(tabla.enviadoEn.name);
  const colUltimoErrorCategoria = sql.identifier(tabla.ultimoErrorCategoria.name);
  const colUltimoErrorCodigo = sql.identifier(tabla.ultimoErrorCodigo.name);
  const colBloqueadoHasta = sql.identifier(tabla.bloqueadoHasta.name);
  const colProximoIntentoEn = sql.identifier(tabla.proximoIntentoEn.name);
  const colActualizadoEn = sql.identifier(tabla.actualizadoEn.name);

  if (resultado.ok) {
    await db.execute(sql`
      update ${tabla}
      set
        ${colEstado} = 'enviado',
        ${colIdExterno} = ${resultado.idExterno ?? null}::text,
        ${colEnviadoEn} = ${momento}::timestamptz,
        ${colUltimoErrorCategoria} = null,
        ${colUltimoErrorCodigo} = null,
        ${colBloqueadoHasta} = null,
        ${colActualizadoEn} = now()
      where ${colId} = ${fila.id}
    `);
    return "enviados";
  }

  const clase = clasificarResultado(resultado);
  const categoria = resultado.categoria;
  const codigo = resultado.codigo ?? null;

  if (clase === "permanente") {
    await db.execute(sql`
      update ${tabla}
      set
        ${colEstado} = 'descartado',
        ${colUltimoErrorCategoria} = ${categoria}::text,
        ${colUltimoErrorCodigo} = ${codigo}::text,
        ${colBloqueadoHasta} = null,
        ${colActualizadoEn} = now()
      where ${colId} = ${fila.id}
    `);
    return "descartados";
  }

  // "transitorio": reintenta si todavía quedan intentos, si no, "fallido".
  if (fila.intentos >= fila.maxIntentos) {
    await db.execute(sql`
      update ${tabla}
      set
        ${colEstado} = 'fallido',
        ${colUltimoErrorCategoria} = ${categoria}::text,
        ${colUltimoErrorCodigo} = ${codigo}::text,
        ${colBloqueadoHasta} = null,
        ${colActualizadoEn} = now()
      where ${colId} = ${fila.id}
    `);
    return "fallidos";
  }

  // `fila.intentos` ya incluye el intento que acaba de fallar (incrementado
  // al reclamarla, ver `reclamarLote`): `fila.intentos - 1` es el número
  // 0-based de fallos previos, la misma convención que espera `backoff`.
  const esperaMs = backoff(fila.intentos - 1);
  const proximoIntento = new Date(momento.getTime() + esperaMs);
  await db.execute(sql`
    update ${tabla}
    set
      ${colEstado} = 'pendiente',
      ${colProximoIntentoEn} = ${proximoIntento}::timestamptz,
      ${colUltimoErrorCategoria} = ${categoria}::text,
      ${colUltimoErrorCodigo} = ${codigo}::text,
      ${colBloqueadoHasta} = null,
      ${colActualizadoEn} = now()
    where ${colId} = ${fila.id}
  `);
  return "reintentar";
}
