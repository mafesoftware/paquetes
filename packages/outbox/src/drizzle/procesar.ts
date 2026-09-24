import { sql } from "drizzle-orm";
import { backoff } from "../backoff.js";
import { clasificarResultado, type ResultadoTransporte } from "../clasificar-resultado.js";
import { ErrorOutbox } from "../errores.js";
import type { CanalOutbox } from "../tipos.js";
import type { Transporte } from "../transporte.js";
import type { DbCliente } from "./cliente.js";
import { contarAfectadas } from "./contar-afectadas.js";
import type { TablaOutbox } from "./tabla.js";

/** Tope de caracteres de `ultimo_error_codigo` — ver el JSDoc de `Transporte` sobre por qué nunca debería necesitarse tanto margen (nunca debería traer texto libre), y por qué igual se recorta. */
const MAXIMO_LARGO_CODIGO = 64;

/** Piso del backoff para `"conflicto_idempotencia"` (HTTP 409 de Resend) — ver `registrarResultado`. */
const BACKOFF_MINIMO_CONFLICTO_IDEMPOTENCIA_MS = 60_000;

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
  /** Cuánto dura el lease de una fila reclamada antes de considerarse "colgada" y quedar disponible para que otro worker la reclame de nuevo. `600_000` (10 min) por defecto. Tiene que ser `>= 5000` — con un lease más corto no queda margen razonable para `timeoutMs` más el colchón de 1 s de "Cola del pool y lease" (más abajo). */
  leaseMs?: number;
  /**
   * Cuánto esperar la respuesta de un `Transporte` antes de darla por
   * perdida y tratarla como `"transitorio"` (`codigo: "timeout"`).
   * `60_000` (1 min) por defecto — antes (ronda de fix 3) era `Math.floor(leaseMs
   * / 2)`, pero eso hacía que los valores por defecto del PROPIO paquete
   * (`lote: 20`, `concurrencia: 5`, `leaseMs: 600_000`) dispararan su
   * propia advertencia de "Cola del pool y lease" (más abajo): con
   * `timeoutMs` igual a `leaseMs / 2`, `timeoutMs * ceil(lote /
   * concurrencia)` da `leaseMs * (olas / 2)`, que para cualquier `olas >=
   * 3` ya supera `leaseMs` — los defaults de este paquete tienen `olas =
   * 4`. Con `60_000` fijo, `60_000 * 4 = 240_000 < 600_000`: los defaults
   * no se avisan a sí mismos (ronda de fix 3b). Tiene que ser `> 0` y `<=
   * leaseMs / 2` — no solo `< leaseMs` (la validación de la ronda 2): con
   * un `timeoutMs` cercano a `leaseMs` casi cualquier fila termina con
   * `restante < timeoutMs` para cuando le toca su turno en el pool (ver
   * "Cola del pool y lease" más abajo) y se LIBERA en vez de intentarse.
   * **Si se customiza `leaseMs` por debajo de `120_000` sin pasar
   * `timeoutMs` explícito, el default fijo (`60_000`) va a violar `<=
   * leaseMs / 2` y `procesarOutbox` tira `ErrorOutbox("opciones_invalidas")`**
   * — con un `leaseMs` chico, hay que pasar `timeoutMs` explícito.
   */
  timeoutMs?: number;
  /**
   * Cuántas filas del lote se procesan (transporte + registro) EN
   * SIMULTÁNEO. `5` por defecto. Entero `>= 1`. No es el tamaño del lote
   * (`lote`) — es cuántas de esas filas están "en vuelo" a la vez: con
   * `lote: 50, concurrencia: 5`, nunca hay más de 5 llamadas a un
   * `Transporte` al mismo tiempo, aunque se reclamen 50 filas.
   */
  concurrencia?: number;
}

/** Resumen de una corrida de `procesarOutbox`. */
export interface ResumenProcesarOutbox {
  /** Cuántas filas se reclamaron en esta corrida (incluye las que venían `"pendiente"` y las `"procesando"` con el lease vencido, y las que se cerraron directo a `"fallido"` por intentos agotados sin llegar a intentar el envío). */
  reclamados: number;
  enviados: number;
  /** Fallo transitorio, todavía con intentos disponibles: quedó `"pendiente"` de nuevo, agendada con `backoff`. */
  reintentar: number;
  /** Fallo transitorio que agotó `maxIntentos` (incluido agotarlo por leases vencidos repetidos — `codigo: "lease_agotado"`/`"intentos_agotados"`, sin haber llegado a intentar el envío esa vez): quedó `"fallido"`, no se reintenta más. */
  fallidos: number;
  /** Fallo permanente (o canal sin `Transporte` configurado): quedó `"descartado"` sin gastar reintentos. */
  descartados: number;
  /**
   * El registro del resultado no pudo escribirse porque la fila YA NO
   * estaba en el mismo `"procesando"` con el MISMO lease con el que este
   * worker la reclamó — otro worker la reclamó de nuevo (el lease de ESTE
   * worker venció mientras el `Transporte` seguía en vuelo) y probablemente
   * ya registró su propio resultado. El intento de ESTE worker se descarta
   * SIN pisar lo que el otro worker ya haya escrito — ver "Escrituras con
   * cerrojo (fencing)" en el JSDoc de `procesarOutbox`. No es un error: es
   * la señal de que la protección contra sobre-escritura funcionó.
   */
  perdidos: number;
  /**
   * La fila se devolvió a `"pendiente"` SIN llamar a ningún `Transporte`
   * porque, para cuando le tocó su turno (cola del pool con `concurrencia`
   * limitada), ya no quedaba margen seguro de lease para intentar un envío
   * — ver "Cola del pool y lease" en el JSDoc de `procesarOutbox`. El
   * intento se "devuelve" (`intentos - 1`) porque nunca se gastó de
   * verdad: no se llamó a nada.
   */
  liberados: number;
  /**
   * Cuántas operaciones de BASE (el reclamo del lote, o el registro de un
   * resultado) tiraron una excepción — `procesarOutbox` las atrapa todas,
   * nunca propaga. Si el reclamo mismo falla, `reclamados` queda en `0` y
   * `errores` en al menos `1`; si falla el registro de UNA fila reclamada,
   * esa fila no suma en ningún otro balde (ni `enviados` ni `reintentar`
   * ni...) — el `Transporte` para esa fila SÍ se llamó, pero no se sabe si
   * el resultado quedó guardado, así que en la próxima corrida esa fila
   * puede reclamarse de nuevo (mismas garantías de "al menos una vez" que
   * el resto de la cola).
   */
  errores: number;
  /** El código de Postgres (ej. `"57P01"`) del ÚLTIMO error de base atrapado en esta corrida — NUNCA el mensaje ni los parámetros (pueden traer datos del destinatario). `undefined` si `errores` es `0`, o si no se pudo determinar un código. */
  ultimoError?: { codigo: string | null };
  /**
   * Avisos sobre la CONFIGURACIÓN de esta corrida (nunca sobre datos de
   * ninguna fila) — `[]` si no hay ninguno. Nunca se loguean solos (ni con
   * `console.warn` ni de ninguna otra forma): viajan en el resumen para que
   * quien llama decida qué hacer (loguearlos, mandarlos a un panel,
   * ignorarlos). Hoy el único aviso posible: `leaseMs` corto frente a
   * `timeoutMs * ceil(lote / concurrencia)` — ver el JSDoc de la función.
   */
  advertencias: string[];
}

/** Una fila ya reclamada, tal como la devuelve `reclamarLote`. */
interface FilaReclamada {
  id: string;
  tenantId: string;
  canal: CanalOutbox;
  destino: string;
  plantilla: string;
  datos: unknown;
  claveIdempotencia: string;
  /** Ya incluye el intento que se acaba de reclamar (incrementado al reclamarla), salvo en la rama `"fallido"` de `estadoResultante` (ver su JSDoc), donde NO se incrementó. */
  intentos: number;
  maxIntentos: number;
  /** El lease con el que ESTE worker la reclamó — se usa para "cerrojar" el `UPDATE` que registra el resultado o la libera (ver `registrarResultado`/`liberarFila`). `null` cuando `estadoResultante` ya es `"fallido"` (la fila ya quedó cerrada en el reclamo mismo, sin lease nuevo). */
  bloqueadoHasta: Date | null;
  /** `"procesando"`: hay que decidir si llamar al `Transporte` (ver "Cola del pool y lease") y registrar el resultado. `"fallido"`: `reclamarLote` ya la cerró (intentos agotados, por lease vencido repetidas veces o de entrada) — no se llama a ningún `Transporte`. */
  estadoResultante: "procesando" | "fallido";
}

/** Lo que devuelve la consulta de reclamo TAL CUAL (antes de normalizar `bloqueadoHasta` a `Date` — ver `reclamarLote`). */
type FilaReclamadaCruda = Omit<FilaReclamada, "bloqueadoHasta"> & { bloqueadoHasta: string | null };

/** El resumen "en cero" — `advertencias` se arma aparte (depende de las opciones validadas de CADA corrida), así que se pasa siempre explícito, nunca se comparte una instancia fija. */
function resumenVacio(advertencias: string[]): ResumenProcesarOutbox {
  return {
    reclamados: 0,
    enviados: 0,
    reintentar: 0,
    fallidos: 0,
    descartados: 0,
    perdidos: 0,
    liberados: 0,
    errores: 0,
    advertencias,
  };
}

/**
 * Procesa hasta `lote` mensajes debidos de la cola: los reclama de forma
 * atómica (`FOR UPDATE SKIP LOCKED`), llama al `Transporte` de cada canal
 * (con un tope de `concurrencia` simultáneos y un `timeoutMs` por intento),
 * y registra el resultado.
 *
 * **Entrega AL MENOS UNA VEZ, no exactamente una vez.** `SKIP LOCKED` evita
 * que DOS workers tengan la MISMA fila reclamada (con un lease vigente) al
 * mismo tiempo — mientras un worker la tiene, otro no la ve como candidata.
 * Eso NO alcanza para "nunca se manda dos veces": si un worker le pide al
 * `Transporte` que mande el mensaje, el proveedor lo acepta, y el worker se
 * cae (o el proceso se reinicia) ANTES de terminar de registrar el
 * resultado, el lease de esa fila vence igual y OTRO worker la va a
 * reclamar de nuevo más tarde — que es exactamente lo que se espera que
 * pase (si no, un worker caído perdería el mensaje para siempre). Ese
 * segundo intento manda el mensaje OTRA VEZ. La única defensa real contra
 * ese duplicado es que el PROVEEDOR reconozca una clave de idempotencia
 * propia — por eso `MensajeParaEnviar` incluye `claveIdempotencia`
 * (`${tenantId}:${claveIdempotencia}` de la fila) y `transporteCorreo` la
 * pasa como header `Idempotency-Key` de Resend (ver
 * `@mafesoftware/correo`); para WhatsApp, `kapso-wa` hoy no expone ese
 * mecanismo — ver el JSDoc de `transporteWhatsApp`. **Lo mismo vale para el
 * timeout**: si un intento tarda más que `timeoutMs`, `procesarOutbox` lo
 * da por perdido y sigue (ver `intentarTransporte`), pero el PROVEEDOR
 * puede haber recibido el pedido igual y entregarlo más tarde — abortar la
 * `señal` corta el pedido de ESTE lado, no lo deshace del otro.
 *
 * **Escrituras con cerrojo (fencing).** Cada fila que `reclamarLote`
 * reclama se marca con su PROPIO `bloqueado_hasta` (el lease nuevo). El
 * `UPDATE` que registra el resultado (`registrarResultado`) o que libera
 * una fila sin intentarla (`liberarFila`) SIEMPRE incluye `WHERE ... AND
 * estado = 'procesando' AND bloqueado_hasta = <ese mismo lease>` — nunca
 * solo `WHERE id = ...`. Si para cuando se escribe la fila YA NO tiene ese
 * lease exacto (otro worker la reclamó de nuevo porque el lease de ESTE
 * worker venció mientras esperaba, y probablemente ya registró su propio
 * resultado), el `UPDATE` no afecta ninguna fila — se cuenta en `perdidos`,
 * y el resultado que llegó tarde NUNCA pisa lo que el otro worker ya haya
 * escrito.
 *
 * **Cola del pool y lease.** Todas las filas de UN reclamo comparten el
 * mismo `bloqueado_hasta` (calculado una vez, al reclamar el lote entero) —
 * pero con `concurrencia` limitada, no todas empiezan a procesarse al
 * mismo tiempo: una fila puede quedar esperando su turno en el pool
 * mientras OTRAS, antes en la cola, todavía están "en vuelo" (sobre todo
 * si tardan hasta `timeoutMs` cada una). Si a una fila le toca el turno
 * cuando ya casi no le queda lease, intentar el envío de todos modos es
 * peligroso: para cuando el intento termine, el lease puede haber vencido
 * hace rato, y OTRO worker puede haberla reclamado y ya estar mandándola —
 * dos invocaciones reales del `Transporte` para la MISMA fila, reproducido
 * contra Postgres real (lote de varias filas, `concurrencia: 1`, un
 * `Transporte` lento, un segundo worker que arranca antes de que el
 * primero termine de vaciar su cola).
 *
 * Por eso, INMEDIATAMENTE ANTES de llamar al `Transporte` de cada fila, se
 * recalcula `restante = bloqueadoHasta - ahora()` (con el reloj real de
 * ESE momento, no el del reclamo). Si `restante <= timeoutMs` (el mismo
 * `timeoutMs` hace de margen de seguridad), la fila se LIBERA sin llamar a
 * nada: vuelve a `"pendiente"`, con `bloqueado_hasta = null`,
 * `proximo_intento_en = ahora()` (vuelve a estar debida ya mismo) e
 * `intentos - 1` (el intento que se reclamó pero nunca se gastó de
 * verdad, porque no se llegó a intentar nada) — cerrojado igual que
 * `registrarResultado`, así que si para cuando se escribe esto la fila ya
 * no tiene el mismo lease, no pisa nada (se cuenta en `perdidos`, no en
 * `liberados`). Se cuenta en el balde nuevo `liberados`.
 *
 * Si en cambio SÍ alcanza el margen, el intento corre igual, pero con un
 * timeout EFECTIVO recortado a `min(timeoutMs, restante - 1000)` — nunca
 * más que el `timeoutMs` configurado, pero tampoco más que lo que
 * realmente queda de lease (menos un segundo de margen para la propia
 * escritura del resultado) — así ningún intento puede terminar DESPUÉS de
 * que su lease haya vencido.
 *
 * **Dos fases, con transacciones DISTINTAS a propósito:**
 *
 * 1. **Reclamo** (una transacción corta): `WITH candidatos AS (SELECT ...
 *    FOR UPDATE SKIP LOCKED) UPDATE ... RETURNING ...` — candidatas:
 *    `"pendiente"` con `programado_para`/`proximo_intento_en` ya
 *    cumplidos, MÁS `"procesando"` cuyo `bloqueado_hasta` ya venció (un
 *    worker anterior se cayó a mitad de camino). Entre esas últimas, si
 *    `intentos >= maxIntentos` YA (agotó los intentos a fuerza de leases
 *    vencidos sucesivos, sin que ninguno haya llegado a registrar un
 *    resultado real), la fila se cierra DIRECTO a `"fallido"`
 *    (`codigo: "lease_agotado"` si venía `"procesando"`, `codigo:
 *    "intentos_agotados"` si venía `"pendiente"` — salvaguarda, no debería
 *    pasar en el flujo normal) EN ESA MISMA sentencia — sin incrementar
 *    `intentos` de nuevo, y sin llamar a ningún `Transporte` — ver "Bucle
 *    de caídas" más abajo. El resto se marca `"procesando"`, con su lease
 *    nuevo, `intentos + 1`. `SKIP LOCKED` es lo que hace que dos
 *    `procesarOutbox` concurrentes se REPARTAN el trabajo en vez de
 *    pisarse. Esta fase es TAN CORTA como sea posible (nada de llamadas de
 *    red adentro).
 * 2. **Envío y registro** (fuera de esa transacción, con un tope de
 *    `concurrencia` simultáneos, una transacción corta POR FILA para el
 *    `UPDATE` final, cerrojada como se explicó arriba).
 *
 * **Bucle de caídas.** Sin el chequeo del punto 1, una fila cuyo
 * `Transporte` SIEMPRE tarda más que el lease (o cuyo worker SIEMPRE se
 * cae antes de registrar) se reclamaría para siempre, sumando `intentos`
 * sin tope real — `maxIntentos` dejaría de significar nada. Con el
 * chequeo, al tercer... o quinto... reclamo con lease vencido (según
 * `maxIntentos`), la fila se cierra sola, sin más intentos de red.
 *
 * **La comparación del lease vencido es `bloqueado_hasta <= ahora`**
 * (inclusive), la MISMA que usa `decidir` (`@mafesoftware/outbox`, núcleo)
 * — las dos tienen que dar la misma respuesta para los mismos datos.
 *
 * **Un canal sin `Transporte` configurado** descarta sus mensajes con
 * `categoria: "credenciales"`, `codigo: "transporte_no_configurado"`.
 *
 * **Nunca tira.** Un `Transporte` que TIRA (no respeta su contrato) se
 * atrapa y se trata como `"transitorio"` (`codigo:
 * "transporte_excepcion"`), sin loguear el error crudo. Un `Transporte`
 * que no responde en el timeout efectivo se trata igual (`codigo:
 * "timeout"`). Y un fallo de la BASE (el reclamo del lote, o el `UPDATE`
 * que registra un resultado o libera una fila) TAMPOCO se propaga: se
 * atrapa, se cuenta en `errores`, y el código de Postgres (nunca el
 * mensaje ni los parámetros) queda en `ultimoError`. Si el reclamo mismo
 * falla, esta función devuelve `{ ...vacío, errores: 1, ultimoError }` sin
 * haber tocado ninguna fila. Si falla el registro de UNA fila entre varias
 * (`concurrencia` > 1, semántica `allSettled`: un fallo en una fila no
 * aborta el resto), esa fila queda sin sumar en ningún balde de
 * resultado.
 *
 * Devuelve `{ reclamados, enviados, reintentar, fallidos, descartados,
 * perdidos, liberados, errores, advertencias, ultimoError? }`.
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
 *   concurrencia: 10,
 * });
 * // { reclamados: 12, enviados: 10, reintentar: 1, fallidos: 0, descartados: 1, perdidos: 0, liberados: 0, errores: 0, advertencias: [] }
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
  // I2: piso de 5 s — con un lease más corto no queda margen razonable para
  // "timeoutMs" más el colchón de 1 s de "Cola del pool y lease" (JSDoc de
  // arriba); casi cualquier `timeoutMs` válido terminaría liberando TODO,
  // sin que la validación de abajo (que sí exige `timeoutMs <= leaseMs / 2`)
  // alcance a evitarlo del todo en el extremo.
  if (!(leaseMs >= 5000)) {
    throw new ErrorOutbox("opciones_invalidas", `procesarOutbox: "leaseMs" tiene que ser >= 5000 (fue ${leaseMs}).`);
  }
  // Ronda de fix 3b: default FIJO (60_000), no más `Math.floor(leaseMs / 2)`
  // — ver el JSDoc de la opción para el porqué (los defaults del propio
  // paquete disparaban su propia advertencia con el default anterior).
  const timeoutMs = opciones.timeoutMs ?? 60_000;
  if (!(timeoutMs > 0)) {
    throw new ErrorOutbox("opciones_invalidas", `procesarOutbox: "timeoutMs" tiene que ser > 0 (fue ${timeoutMs}).`);
  }
  // I1: `<= leaseMs / 2`, no solo `< leaseMs` (la validación de la ronda
  // anterior) — ver el JSDoc de la opción para el porqué (un `timeoutMs`
  // cercano a `leaseMs` deja "Cola del pool y lease" sin margen real para
  // distinguir "alcanza" de "no alcanza").
  if (!(timeoutMs <= leaseMs / 2)) {
    throw new ErrorOutbox(
      "opciones_invalidas",
      `procesarOutbox: "timeoutMs" tiene que ser <= "leaseMs / 2" (timeoutMs=${timeoutMs}, leaseMs=${leaseMs}, leaseMs/2=${leaseMs / 2}).`,
    );
  }
  const concurrencia = opciones.concurrencia ?? 5;
  if (!Number.isInteger(concurrencia) || concurrencia < 1) {
    throw new ErrorOutbox("opciones_invalidas", `procesarOutbox: "concurrencia" tiene que ser un entero >= 1 (fue ${concurrencia}).`);
  }
  if (opciones.transportes.correo !== undefined && typeof opciones.transportes.correo !== "function") {
    throw new ErrorOutbox("opciones_invalidas", 'procesarOutbox: "transportes.correo" (si se pasa) tiene que ser una función.');
  }
  if (opciones.transportes.whatsapp !== undefined && typeof opciones.transportes.whatsapp !== "function") {
    throw new ErrorOutbox("opciones_invalidas", 'procesarOutbox: "transportes.whatsapp" (si se pasa) tiene que ser una función.');
  }
  const ahora = opciones.ahora ?? (() => new Date());

  // Aviso (nunca un error): con `concurrencia` acotada y un `lote` grande,
  // el PEOR caso (todas las filas del lote necesitan la cola entera del
  // pool, cada una tardando hasta `timeoutMs`) puede superar `leaseMs` —
  // no es inseguro (el chequeo de "Cola del pool y lease" libera lo que no
  // llega a tiempo en vez de arriesgarse), pero sí es un desperdicio real:
  // muchas filas van a terminar en `liberados` en vez de intentarse. Se
  // avisa en el RESUMEN, nunca con un log — quien llama decide qué hacer.
  const advertencias: string[] = [];
  const olasDelPool = Math.ceil(lote / concurrencia);
  if (leaseMs < timeoutMs * olasDelPool) {
    advertencias.push(
      `leaseMs (${leaseMs}) es menor que timeoutMs * ceil(lote / concurrencia) (${timeoutMs} * ${olasDelPool} = ${timeoutMs * olasDelPool}) — con "concurrencia" baja y un "lote" grande, muchas filas pueden llegar a su turno sin margen de lease y liberarse en vez de intentarse (ver "liberados" en el resumen). Subí "leaseMs", subí "concurrencia", o bajá "lote".`,
    );
  }

  const momento = ahora();
  let reclamados: FilaReclamada[];
  try {
    reclamados = await opciones.db.transaction((tx) => reclamarLote(tx, opciones.tabla, lote, momento, leaseMs));
  } catch (error) {
    // Ver "Nunca tira" en el JSDoc de arriba: un fallo de la base durante el
    // reclamo no se propaga. No se sabe si ALGUNA fila quedó reclamada (el
    // error puede haber pasado en cualquier punto de la transacción, que
    // hizo rollback entera), así que `reclamados` queda en 0 — ninguna fila
    // real quedó "procesando" sin cerrar.
    return { ...resumenVacio(advertencias), errores: 1, ultimoError: { codigo: codigoPgDeError(error) } };
  }

  if (reclamados.length === 0) return resumenVacio(advertencias);

  const resumen: ResumenProcesarOutbox = { ...resumenVacio(advertencias), reclamados: reclamados.length };

  const resultados = await procesarConLimite(reclamados, concurrencia, async (fila) => {
    if (fila.estadoResultante === "fallido") {
      // Ya la cerró reclamarLote (intentos agotados, ver su JSDoc) — no hay
      // Transporte que llamar ni resultado que registrar.
      return "fallidos" as const;
    }

    // M1: `reclamarLote` normaliza `bloqueadoHasta` de vuelta a `Date` (ver
    // su JSDoc), pero viene de un `RETURNING` de SQL crudo — si esa
    // normalización fallara o el dato viniera corrupto, `.getTime()` de un
    // no-`Date`/`Invalid Date` da `NaN`, no tira. Con `NaN` la comparación
    // de abajo (`restanteMs < minimoRestante`) es SIEMPRE falsa (`NaN < x`
    // es `false`), así que sin esta guarda se intentaría igual el
    // Transporte con un `timeoutEfectivoMs` también `NaN` — mejor perder la
    // fila explícitamente (sin tocar ningún Transporte) que arriesgar un
    // envío con un lease que no se puede verificar.
    if (!(fila.bloqueadoHasta instanceof Date) || Number.isNaN(fila.bloqueadoHasta.getTime())) {
      return "perdidos" as const;
    }

    // "Cola del pool y lease" (ver el JSDoc de arriba): se recalcula con el
    // reloj de ESTE momento, no el del reclamo — puede haber pasado tiempo
    // real esperando su turno en el pool.
    const momentoDelTurno = ahora();
    const restanteMs = fila.bloqueadoHasta.getTime() - momentoDelTurno.getTime();
    // I1/I2: se libera si no queda margen para un intento con sentido —
    // "margen para un intento con sentido" es `timeoutMs` (el tiempo que de
    // verdad se le va a dar al Transporte) más el colchón fijo de 1 s con
    // el que se calcula `timeoutEfectivoMs` más abajo. Con esto, cuando SÍ
    // se intenta (`restanteMs >= minimoRestante`), `restanteMs - 1000` es
    // siempre `>= timeoutMs`, así que el clamp de abajo da exactamente
    // `timeoutMs` — nunca un timeout efectivo más chico y "raro" que el
    // configurado.
    const minimoRestante = timeoutMs + 1000;
    if (restanteMs < minimoRestante) {
      return liberarFila(opciones.db, opciones.tabla, fila, momentoDelTurno);
    }

    const timeoutEfectivoMs = Math.max(1000, Math.min(timeoutMs, restanteMs - 1000));
    const resultado = await intentarTransporte(opciones.transportes, fila, timeoutEfectivoMs);
    return registrarResultado(opciones.db, opciones.tabla, fila, resultado, ahora());
  });

  for (const resultado of resultados) {
    if (resultado.status === "fulfilled") {
      resumen[resultado.value] += 1;
    } else {
      resumen.errores += 1;
      resumen.ultimoError = { codigo: codigoPgDeError(resultado.reason) };
    }
  }

  return resumen;
}

/**
 * `error.cause.code` (o `error.code`) si es un `string` — NUNCA el mensaje
 * ni ninguna otra propiedad (pueden traer el SQL armado y los parámetros
 * bindeados, ver `errorSeguro` de `@mafesoftware/auditoria/drizzle` para el
 * mismo problema con `DrizzleQueryError`). Nunca tira: cualquier lectura
 * rota (un `Proxy`, un getter que tira) da `null`.
 */
function codigoPgDeError(error: unknown): string | null {
  try {
    const causa = error !== null && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined;
    const deLaCausa = causa !== null && typeof causa === "object" ? (causa as { code?: unknown }).code : undefined;
    if (typeof deLaCausa === "string") return deLaCausa;
    const propio = error !== null && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
    return typeof propio === "string" ? propio : null;
  } catch {
    return null;
  }
}

/**
 * Corre `fn` sobre `items`, como mucho `limite` a la vez, y devuelve UN
 * resultado por item en el MISMO orden — `{ status: "fulfilled", value }` o
 * `{ status: "rejected", reason }`, misma forma que
 * `Promise.allSettled` (que no sirve sola acá: no tiene forma de limitar
 * cuántas promesas están en vuelo a la vez, y con `lote` grande eso manda
 * decenas de conexiones a la base y llamadas de red simultáneas sin
 * ningún control). Que UN item falle (tire) nunca frena a los demás — cada
 * uno corre en su propio `try/catch`.
 */
async function procesarConLimite<T, R>(
  items: readonly T[],
  limite: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const resultados: PromiseSettledResult<R>[] = new Array(items.length);
  let siguiente = 0;

  async function trabajador(): Promise<void> {
    while (true) {
      const indice = siguiente++;
      if (indice >= items.length) return;
      try {
        resultados[indice] = { status: "fulfilled", value: await fn(items[indice] as T) };
      } catch (error) {
        resultados[indice] = { status: "rejected", reason: error };
      }
    }
  }

  const trabajadores = Array.from({ length: Math.min(limite, items.length) }, () => trabajador());
  await Promise.all(trabajadores);
  return resultados;
}

/**
 * La consulta de reclamo: un único `WITH ... SELECT ... FOR UPDATE SKIP
 * LOCKED` (candidatos) + `UPDATE ... FROM candidatos` (marca y devuelve).
 * Ver el JSDoc de `procesarOutbox` para el porqué de cada pieza, en
 * particular "Bucle de caídas" (el `CASE` que cierra a `"fallido"` sin
 * reintentar cuando ya no quedan intentos).
 *
 * **Pensada para `READ COMMITTED`** (el aislamiento default de Postgres) —
 * bajo ese aislamiento, `FOR UPDATE SKIP LOCKED` alcanza solo para el
 * reparto entre workers concurrentes, sin necesitar `SERIALIZABLE` ni
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
  const colClaveIdem = sql.identifier(tabla.claveIdempotencia.name);
  const colIntentos = sql.identifier(tabla.intentos.name);
  const colMaxIntentos = sql.identifier(tabla.maxIntentos.name);
  const colProgramadoPara = sql.identifier(tabla.programadoPara.name);
  const colProximoIntentoEn = sql.identifier(tabla.proximoIntentoEn.name);
  const colBloqueadoHasta = sql.identifier(tabla.bloqueadoHasta.name);
  const colUltimoErrorCategoria = sql.identifier(tabla.ultimoErrorCategoria.name);
  const colUltimoErrorCodigo = sql.identifier(tabla.ultimoErrorCodigo.name);
  const colActualizadoEn = sql.identifier(tabla.actualizadoEn.name);

  const bloqueadoHastaNuevo = new Date(momento.getTime() + leaseMs);
  const agotada = sql`${tabla}.${colIntentos} >= ${tabla}.${colMaxIntentos}`;

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
        and ${colBloqueadoHasta} <= ${momento}::timestamptz
      )
      order by coalesce(${colProximoIntentoEn}, ${colProgramadoPara}) asc
      limit ${lote}
      for update skip locked
    )
    update ${tabla}
    set
      ${colEstado} = case when ${agotada} then 'fallido' else 'procesando' end,
      ${colIntentos} = case when ${agotada} then ${tabla}.${colIntentos} else ${tabla}.${colIntentos} + 1 end,
      ${colBloqueadoHasta} = case when ${agotada} then null else ${bloqueadoHastaNuevo}::timestamptz end,
      ${colUltimoErrorCategoria} = case when ${agotada} then 'red'::text else ${tabla}.${colUltimoErrorCategoria} end,
      -- L3: el motivo distingue si YA estaba "procesando" (reclamos repetidos
      -- con el lease vencido, sin que ninguno llegara a intentar el envío —
      -- "lease_agotado") de la salvaguarda de una fila "pendiente" que
      -- llegara acá con los intentos ya agotados sin que nadie la haya
      -- cerrado ("intentos_agotados", no debería pasar en el flujo normal).
      ${colUltimoErrorCodigo} = case
        when ${agotada} and ${tabla}.${colEstado} = 'procesando' then 'lease_agotado'::text
        when ${agotada} then 'intentos_agotados'::text
        else ${tabla}.${colUltimoErrorCodigo}
      end,
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
      ${tabla}.${colClaveIdem} as "claveIdempotencia",
      ${tabla}.${colIntentos} as intentos,
      ${tabla}.${colMaxIntentos} as "maxIntentos",
      ${tabla}.${colBloqueadoHasta} as "bloqueadoHasta",
      ${tabla}.${colEstado} as "estadoResultante"
  `;

  const resultado = (await tx.execute(consulta)) as unknown as { rows: FilaReclamadaCruda[] };
  // `tx.execute(...)` con SQL crudo (no el query builder de Drizzle) NO
  // decodifica columnas `timestamptz` a `Date` — vuelven como el texto
  // que da Postgres (ej. `"2026-09-24 16:19:35.239+00"`), a diferencia de
  // una columna leída con el query builder, o de una consulta hecha
  // directo con `pg` (`Pool.query`, que SÍ la parsea sola). Se normaliza
  // acá, una vez, para que el resto de este archivo pueda tratar
  // `bloqueadoHasta` como el `Date` que dice su tipo — reproducido con
  // Postgres real: sin esto, `fila.bloqueadoHasta.getTime()` tira
  // `TypeError` (ver la ronda de fix 2 de este paquete).
  return resultado.rows.map((fila) => ({
    ...fila,
    bloqueadoHasta: fila.bloqueadoHasta === null ? null : new Date(fila.bloqueadoHasta),
  }));
}

/**
 * Llama al `Transporte` del canal de `fila`, con un tope de `timeoutMs`
 * (el EFECTIVO, ya recortado por "Cola del pool y lease" en el JSDoc de
 * `procesarOutbox` — esta función no sabe ni le importa de dónde salió).
 * Nunca tira: un canal sin `Transporte` configurado, un `Transporte` que
 * TIRA, o uno que no responde a tiempo, dan un `ResultadoTransporte` —
 * nunca se propaga ni se loguea el error crudo (puede traer datos del
 * destinatario).
 *
 * El timeout se implementa con `Promise.race` contra un temporizador: pasado
 * `timeoutMs`, se aborta la `señal` que recibió el `Transporte` (por si
 * coopera cancelando su propia llamada de red) y se resuelve con
 * `{ ok: false, categoria: "red", codigo: "timeout" }` — el `Transporte`
 * que sigue en vuelo puede terminar más tarde igual, pero para entonces ya
 * se decidió tratar este intento como fallido; su resultado (si llega) se
 * descarta sin volver a tirar ni a colgar el proceso (queda atrapado en su
 * propio `try/catch`, nunca sin manejar). Abortar la señal NO deshace un
 * envío que el proveedor ya haya aceptado del otro lado — ver "Entrega al
 * menos una vez" en el JSDoc de `procesarOutbox`.
 */
async function intentarTransporte(
  transportes: { correo?: Transporte; whatsapp?: Transporte },
  fila: FilaReclamada,
  timeoutMs: number,
): Promise<ResultadoTransporte> {
  const transporte = transportes[fila.canal];
  if (!transporte) {
    return { ok: false, categoria: "credenciales", codigo: "transporte_no_configurado" };
  }

  const mensaje = {
    id: fila.id,
    tenantId: fila.tenantId,
    canal: fila.canal,
    destino: fila.destino,
    plantilla: fila.plantilla,
    datos: fila.datos,
    claveIdempotencia: `${fila.tenantId}:${fila.claveIdempotencia}`,
  };
  const controlador = new AbortController();

  // Nunca rechaza: cualquier excepción del Transporte (incluida una que
  // tire DESPUÉS de que el timeout ya haya "ganado" la carrera de abajo)
  // queda convertida acá adentro — así `Promise.race` nunca ve un rechazo
  // sin atrapar, ni sin importar cuál de las dos promesas gana.
  const promesaTransporte = (async (): Promise<ResultadoTransporte> => {
    try {
      return await transporte(mensaje, { señal: controlador.signal });
    } catch {
      // "red" (transitorio, ver clasificarResultado): un Transporte que
      // tira no distingue por sí solo si el problema es de red o de otra
      // cosa, y tratarlo como transitorio es la opción segura — nunca se
      // pierde un mensaje real por un bug de un Transporte que no respeta
      // su contrato de "nunca tira".
      return { ok: false, categoria: "red", codigo: "transporte_excepcion" };
    }
  })();

  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const promesaTimeout = new Promise<ResultadoTransporte>((resolve) => {
    temporizador = setTimeout(() => {
      controlador.abort();
      resolve({ ok: false, categoria: "red", codigo: "timeout" });
    }, timeoutMs);
  });

  try {
    return await Promise.race([promesaTransporte, promesaTimeout]);
  } finally {
    clearTimeout(temporizador);
  }
}

type Desenlace = "enviados" | "reintentar" | "fallidos" | "descartados" | "perdidos" | "liberados";

/** Arma la condición `WHERE` cerrojada — compartida por `registrarResultado` y `liberarFila`. Ver "Escrituras con cerrojo" en el JSDoc de `procesarOutbox`. */
function cerrojoDe(tabla: TablaOutbox, fila: FilaReclamada) {
  const colId = sql.identifier(tabla.id.name);
  const colEstado = sql.identifier(tabla.estado.name);
  const colBloqueadoHasta = sql.identifier(tabla.bloqueadoHasta.name);
  return sql`${colId} = ${fila.id} and ${colEstado} = 'procesando' and ${colBloqueadoHasta} = ${fila.bloqueadoHasta}::timestamptz`;
}

/**
 * Libera `fila` SIN haber llamado a ningún `Transporte` — ver "Cola del
 * pool y lease" en el JSDoc de `procesarOutbox`: para cuando le tocó su
 * turno, ya no quedaba margen seguro de lease. Vuelve a `"pendiente"`,
 * `bloqueado_hasta = null`, `proximo_intento_en = momento` (debida ya
 * mismo) e `intentos - 1` (el intento reclamado nunca se gastó de verdad).
 * Cerrojada igual que `registrarResultado`: si la fila ya no tiene el
 * mismo lease, no escribe nada y devuelve `"perdidos"` en vez de
 * `"liberados"`.
 */
async function liberarFila(db: DbCliente, tabla: TablaOutbox, fila: FilaReclamada, momento: Date): Promise<Desenlace> {
  const colEstado = sql.identifier(tabla.estado.name);
  const colBloqueadoHasta = sql.identifier(tabla.bloqueadoHasta.name);
  const colIntentos = sql.identifier(tabla.intentos.name);
  const colProximoIntentoEn = sql.identifier(tabla.proximoIntentoEn.name);
  const colActualizadoEn = sql.identifier(tabla.actualizadoEn.name);
  const colId = sql.identifier(tabla.id.name);

  const consulta = sql`
    update ${tabla}
    set
      ${colEstado} = 'pendiente',
      ${colBloqueadoHasta} = null,
      ${colIntentos} = ${tabla}.${colIntentos} - 1,
      ${colProximoIntentoEn} = ${momento}::timestamptz,
      ${colActualizadoEn} = now()
    where ${cerrojoDe(tabla, fila)}
    returning ${colId}
  `;
  const resultado = await db.execute(consulta);
  return contarAfectadas(resultado) > 0 ? "liberados" : "perdidos";
}

/**
 * Registra el resultado de un intento en la fila `fila`, en su propia
 * transacción corta, CERROJADA por el lease con el que se reclamó (ver
 * "Escrituras con cerrojo" en el JSDoc de `procesarOutbox`). Devuelve la
 * clave del resumen a incrementar.
 */
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

  const cerrojo = cerrojoDe(tabla, fila);

  async function ejecutarCerrojado(fragmento: ReturnType<typeof sql>): Promise<boolean> {
    // `RETURNING` (aunque acá no se usen las filas) es lo que le da a
    // `contarAfectadas` un `rows` con el que contar si el driver no trae
    // `rowCount` — ver su JSDoc.
    const res = await db.execute(sql`update ${tabla} set ${fragmento} where ${cerrojo} returning ${colId}`);
    return contarAfectadas(res) > 0;
  }

  if (resultado.ok) {
    const escrito = await ejecutarCerrojado(sql`
      ${colEstado} = 'enviado',
      ${colIdExterno} = ${resultado.idExterno ?? null}::text,
      ${colEnviadoEn} = ${momento}::timestamptz,
      ${colUltimoErrorCategoria} = null,
      ${colUltimoErrorCodigo} = null,
      ${colBloqueadoHasta} = null,
      ${colActualizadoEn} = now()
    `);
    return escrito ? "enviados" : "perdidos";
  }

  const clase = clasificarResultado(resultado);
  const categoria = resultado.categoria;
  // Recortado a 64 caracteres antes de guardarlo (ver MAXIMO_LARGO_CODIGO):
  // `codigo` nunca debería traer texto libre (ver el contrato de
  // `Transporte`), pero un Transporte de terceros podría no respetarlo —
  // esto es una salvaguarda, no un lugar pensado para texto largo.
  const codigo = resultado.codigo ? resultado.codigo.slice(0, MAXIMO_LARGO_CODIGO) : null;

  if (clase === "permanente") {
    const escrito = await ejecutarCerrojado(sql`
      ${colEstado} = 'descartado',
      ${colUltimoErrorCategoria} = ${categoria}::text,
      ${colUltimoErrorCodigo} = ${codigo}::text,
      ${colBloqueadoHasta} = null,
      ${colActualizadoEn} = now()
    `);
    return escrito ? "descartados" : "perdidos";
  }

  // "transitorio": reintenta si todavía quedan intentos, si no, "fallido".
  if (fila.intentos >= fila.maxIntentos) {
    const escrito = await ejecutarCerrojado(sql`
      ${colEstado} = 'fallido',
      ${colUltimoErrorCategoria} = ${categoria}::text,
      ${colUltimoErrorCodigo} = ${codigo}::text,
      ${colBloqueadoHasta} = null,
      ${colActualizadoEn} = now()
    `);
    return escrito ? "fallidos" : "perdidos";
  }

  // `fila.intentos` ya incluye el intento que acaba de fallar (incrementado
  // al reclamarla, ver `reclamarLote`): `fila.intentos - 1` es el número
  // 0-based de fallos previos, la misma convención que espera `backoff`.
  //
  // L4: `"conflicto_idempotencia"` (HTTP 409 de Resend, ver
  // `clasificarResultado`) lleva un backoff más largo — al menos 60 s, sin
  // importar `intentos` — porque la causa más probable es una carrera
  // contra el propio caché de idempotencia del proveedor, que necesita más
  // tiempo para asentarse que un simple problema de red pasajero.
  const esperaMs =
    categoria === "conflicto_idempotencia"
      ? Math.max(BACKOFF_MINIMO_CONFLICTO_IDEMPOTENCIA_MS, backoff(fila.intentos - 1, { base: BACKOFF_MINIMO_CONFLICTO_IDEMPOTENCIA_MS }))
      : backoff(fila.intentos - 1);
  const proximoIntento = new Date(momento.getTime() + esperaMs);
  const escrito = await ejecutarCerrojado(sql`
    ${colEstado} = 'pendiente',
    ${colProximoIntentoEn} = ${proximoIntento}::timestamptz,
    ${colUltimoErrorCategoria} = ${categoria}::text,
    ${colUltimoErrorCodigo} = ${codigo}::text,
    ${colBloqueadoHasta} = null,
    ${colActualizadoEn} = now()
  `);
  return escrito ? "reintentar" : "perdidos";
}
