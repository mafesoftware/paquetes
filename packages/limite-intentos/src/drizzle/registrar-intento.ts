import { sql } from "drizzle-orm";
import { ErrorLimiteIntentos } from "../errores.js";
import { enteroPositivo } from "../validaciones.js";
import type { DbCliente } from "./cliente.js";
import type { TablaIntentos } from "./tabla.js";

/** Opciones de `registrarIntento`. */
export interface OpcionesRegistrarIntento {
  /** La clave (PK de la tabla) del sujeto — `claveCuenta(email)` o `claveIp(ip)`, del núcleo de este paquete. */
  clave: string;
  /** Tope de intentos dentro de la ventana antes de bloquear. Entero finito `>= 1`. */
  maximo: number;
  /** Duración de la ventana que cuenta los intentos, en ms. Entero finito `>= 1`. */
  ventanaMs: number;
  /** Duración del bloqueo una vez alcanzado `maximo`, en ms. Entero finito `>= 1`. */
  bloqueoMs: number;
  /** De dónde sale "ahora" — inyectable para tests deterministas. `new Date()` si no se pasa. */
  ahora?: Date;
}

/** Lo que devuelve `registrarIntento`. */
export interface ResultadoRegistrarIntento {
  /** `false` si, DESPUÉS de este registro, la clave queda (o sigue) bloqueada — es decir, si `desbloqueaEn` no es `null`. */
  permitido: boolean;
  /** Cuántos intentos más caben antes de bloquear, en la ventana actual. `0` si ya está bloqueada. */
  restantes: number;
  /** Cuándo se destraba, o `null` si no está bloqueada. */
  desbloqueaEn: Date | null;
}

/** Fila cruda que devuelve la consulta atómica. */
interface FilaRegistrarIntento {
  contador: number;
  bloqueadoHasta: string | null;
}

/**
 * Registra UN intento fallido para `clave` y devuelve si, después de este
 * registro, se puede seguir intentando.
 *
 * **No exige transacción** (a diferencia de `siguienteNumero` de
 * `@mafesoftware/numeradores/drizzle` o `encolar` de
 * `@mafesoftware/outbox/drizzle`): es una única sentencia SQL atómica
 * (`INSERT ... ON CONFLICT (clave) DO UPDATE`), así que se puede llamar con
 * `db` directo o con una `tx` — ninguna de las dos formas cambia su
 * atomicidad ni sus garantías bajo concurrencia. Se llama sobre cada
 * intento de ingreso que FALLÓ (un login correcto no debe contar contra el
 * freno: llamar en cambio a `limpiarIntentos`).
 *
 * **Ventana fija, con auto-reinicio** (mismo diseño que
 * `intentosIngreso`/`anotarFallo` de gestionflow, generalizado a
 * `maximo`/`ventanaMs`/`bloqueoMs` configurables): la fila guarda
 * `contador` + `ventana_desde`. Si `ventana_desde` es anterior a
 * `ahora - ventanaMs` (la ventana actual ya venció), el registro ARRANCA
 * una ventana nueva: `contador = 1`, `ventana_desde = ahora`. Si la ventana
 * sigue vigente, `contador` se incrementa sobre el valor que ya tenía. En
 * los dos casos, si el `contador` RESULTANTE llega a `maximo`,
 * `bloqueado_hasta` se fija en `ahora + bloqueoMs` — y si ya estaba
 * bloqueada y la ventana sigue vigente (sigue llegando fuerza bruta), CADA
 * intento nuevo que mantiene `contador >= maximo` vuelve a extender
 * `bloqueado_hasta` a `ahora + bloqueoMs`: el bloqueo se renueva mientras el
 * ataque continúe, en vez de vencer a mitad de un ataque sostenido.
 *
 * **El bloqueo NO se limpia solo cuando expira**: `bloqueado_hasta` se queda
 * con la fecha que se fijó, aunque ya haya pasado — lo único que cambia es
 * que una lectura posterior (esta misma función, o `consultarIntento`) la
 * compara contra un `ahora` más nuevo y ya no la encuentra "en el futuro".
 * Por eso, una vez que el bloqueo expira SIN que llegue ningún intento
 * nuevo durante ese tiempo, `consultarIntento` ya informa que se puede
 * seguir intentando — sin ningún cron ni escritura de "desbloqueo".
 *
 * **Atómico bajo concurrencia**, con un único `INSERT ... ON CONFLICT
 * (clave) DO UPDATE` (mismo patrón que `siguienteNumero`, adaptado de
 * `anotarFallo` de gestionflow): dos llamadas concurrentes para la MISMA
 * `clave` se serializan una detrás de la otra en el lock de esa fila (bajo
 * `READ COMMITTED`, el aislamiento default de Postgres) — ninguna pisa el
 * incremento de la otra. Es lo que prueba el test de 20 llamadas
 * verdaderamente concurrentes contra Postgres real
 * (`tests/drizzle/postgres.test.ts`): el contador final es exactamente 20,
 * nunca menos por una carrera perdida.
 *
 * **Valida las opciones ANTES de tocar la base**: `clave` no puede estar
 * vacía; `maximo`/`ventanaMs`/`bloqueoMs` tienen que ser enteros finitos
 * `>= 1` — todo tira `ErrorLimiteIntentos("opciones_invalidas")`.
 *
 * **Cast explícitos** en cada parámetro de la consulta (`::integer`,
 * `::timestamptz`) para que Postgres nunca tenga que INFERIR el tipo de un
 * parámetro a partir de un literal vecino (mismo motivo que
 * `configurarNumerador` de `@mafesoftware/numeradores/drizzle`: sin el
 * cast, un tipo mal inferido puede tirar `22003`/`42804` en vez de aplicar
 * el valor).
 *
 * ```ts
 * import { registrarIntento } from "@mafesoftware/limite-intentos/drizzle";
 * import { claveCuenta } from "@mafesoftware/limite-intentos";
 *
 * const { permitido, restantes, desbloqueaEn } = await registrarIntento(db, limiteIntentos, {
 *   clave: claveCuenta(email),
 *   maximo: 10,
 *   ventanaMs: 15 * 60_000,
 *   bloqueoMs: 15 * 60_000,
 * });
 * if (!permitido) {
 *   // "Demasiados intentos, probá de nuevo después de desbloqueaEn"
 * }
 * ```
 */
export async function registrarIntento(
  db: DbCliente,
  tabla: TablaIntentos,
  opciones: OpcionesRegistrarIntento,
): Promise<ResultadoRegistrarIntento> {
  if (typeof opciones.clave !== "string" || !opciones.clave.trim()) {
    throw new ErrorLimiteIntentos("opciones_invalidas", 'registrarIntento: "clave" no puede estar vacía.');
  }
  const maximo = enteroPositivo(opciones.maximo, "maximo", "registrarIntento");
  const ventanaMs = enteroPositivo(opciones.ventanaMs, "ventanaMs", "registrarIntento");
  const bloqueoMs = enteroPositivo(opciones.bloqueoMs, "bloqueoMs", "registrarIntento");
  if (opciones.ahora !== undefined && Number.isNaN(opciones.ahora.getTime())) {
    throw new ErrorLimiteIntentos("opciones_invalidas", 'registrarIntento: "ahora" no es una fecha válida.');
  }

  const ahora = opciones.ahora ?? new Date();
  const arranqueDeVentana = new Date(ahora.getTime() - ventanaMs);
  const hastaCuando = new Date(ahora.getTime() + bloqueoMs);
  // Sentinel `null` cuando el INSERT (fila nueva) no llega a bloquear de
  // entrada — el cast explícito (`::timestamptz`) de abajo evita que
  // Postgres tenga que inferirle un tipo a un parámetro que puede ser
  // `null`.
  const bloqueadoHastaInicial: Date | null = 1 >= maximo ? hastaCuando : null;

  const colClave = sql.identifier(tabla.clave.name);
  const colContador = sql.identifier(tabla.contador.name);
  const colVentanaDesde = sql.identifier(tabla.ventanaDesde.name);
  const colBloqueadoHasta = sql.identifier(tabla.bloqueadoHasta.name);
  const colActualizadoEn = sql.identifier(tabla.actualizadoEn.name);

  // `${tabla}.${colContador}`/`${tabla}.${colVentanaDesde}` en el SET, no a
  // secas: dentro de un `ON CONFLICT DO UPDATE`, Postgres tiene EN
  // SIMULTÁNEO en alcance la fila ya existente (la del target table) y la
  // fila propuesta (`excluded`) — un nombre sin calificar que existe en las
  // dos es AMBIGUO (42702), mismo motivo que documenta `siguienteNumero`.
  const consulta = sql`
    insert into ${tabla} (${colClave}, ${colContador}, ${colVentanaDesde}, ${colBloqueadoHasta})
    values (${opciones.clave}, 1::integer, ${ahora}::timestamptz, ${bloqueadoHastaInicial}::timestamptz)
    on conflict (${colClave}) do update set
      ${colContador} = case
        when ${tabla}.${colVentanaDesde} < ${arranqueDeVentana}::timestamptz then 1::integer
        else ${tabla}.${colContador} + 1::integer
      end,
      ${colVentanaDesde} = case
        when ${tabla}.${colVentanaDesde} < ${arranqueDeVentana}::timestamptz then ${ahora}::timestamptz
        else ${tabla}.${colVentanaDesde}
      end,
      ${colBloqueadoHasta} = case
        when (
          ${tabla}.${colVentanaDesde} >= ${arranqueDeVentana}::timestamptz
          and ${tabla}.${colContador} + 1::integer >= ${maximo}::integer
        ) then ${hastaCuando}::timestamptz
        else ${tabla}.${colBloqueadoHasta}
      end,
      ${colActualizadoEn} = now()
    returning ${colContador} as contador, ${colBloqueadoHasta} as "bloqueadoHasta"
  `;

  const resultado = (await db.execute(consulta)) as unknown as { rows: FilaRegistrarIntento[] };
  const fila = resultado.rows[0];
  if (!fila) {
    // No debería pasar nunca: el INSERT ... ON CONFLICT DO UPDATE siempre
    // produce (e inserta o actualiza) exactamente una fila. Si llega acá es
    // un bug de esta función, no un caso de negocio a manejar.
    throw new Error("registrarIntento: la consulta no devolvió ninguna fila (no debería pasar)");
  }

  // `tx.execute(...)` con SQL crudo no decodifica `timestamptz` a `Date`
  // (vuelve como el texto que da Postgres) — se normaliza acá, igual que
  // `reclamarLote` de `@mafesoftware/outbox/drizzle`.
  const bloqueadoHastaResultante = fila.bloqueadoHasta === null ? null : new Date(fila.bloqueadoHasta);
  const bloqueada = bloqueadoHastaResultante !== null && bloqueadoHastaResultante.getTime() > ahora.getTime();

  return {
    permitido: !bloqueada,
    restantes: bloqueada ? 0 : Math.max(0, maximo - fila.contador),
    desbloqueaEn: bloqueada ? bloqueadoHastaResultante : null,
  };
}
