import { sql } from "drizzle-orm";
import { ErrorOutbox } from "../errores.js";
import type { CanalOutbox } from "../tipos.js";
import type { DbCliente } from "./cliente.js";
import type { TablaOutbox } from "./tabla.js";
import { exigirTransaccion } from "./transaccion.js";

const CANALES_VALIDOS: readonly CanalOutbox[] = ["correo", "whatsapp"];

/** Opciones de `encolar`. */
export interface OpcionesEncolar {
  tenantId: string;
  canal: CanalOutbox;
  /** La dirección de mail o el número de WhatsApp (ya normalizado). */
  destino: string;
  plantilla: string;
  /** Lo que la plantilla necesita. `{}` si no se pasa. */
  datos?: unknown;
  /** Para no encolar el mismo aviso dos veces (ej. `"recordatorio-turno-123"`). Única junto con `tenantId`. */
  claveIdempotencia: string;
  /** No se manda antes de este momento. El momento en que se llama a `encolar` (reloj de JS, no `now()` de Postgres — ver el comentario en el cuerpo de la función) si no se pasa. */
  programadoPara?: Date;
  /** Tope de intentos antes de `"fallido"`. `5` si no se pasa. Tiene que ser un entero `>= 1`. */
  maxIntentos?: number;
}

/** Lo que devuelve `encolar`. */
export interface ResultadoEncolar {
  /** El id de la fila — la que se acaba de crear, o la que YA existía si `claveIdempotencia` chocó. */
  id: string;
  /** `false` si ya existía una fila con esa `(tenantId, claveIdempotencia)` — no se creó una nueva ni se tocó la existente. */
  nuevo: boolean;
}

/** Fila cruda que devuelve la consulta (columnas por alias fijo, no los nombres reales configurables de la tabla). */
interface FilaId {
  id: string;
}

/**
 * Encola un mensaje. **Exige transacción** (`exigirTransaccion`): tira
 * `ErrorOutbox("requiere_transaccion")` si `tx` no es la que entrega
 * `db.transaction(async (tx) => ...)` — el mensaje solo tiene sentido si el
 * HECHO DE NEGOCIO que lo dispara (crear el pedido, confirmar el pago)
 * también confirma; si `encolar` corriera fuera de esa transacción y el
 * resto del flujo hiciera rollback, quedaría un aviso encolado de algo que
 * nunca pasó.
 *
 * **Idempotente por `(tenantId, claveIdempotencia)`**: un único `INSERT ...
 * ON CONFLICT (tenant, clave_idempotencia) DO NOTHING`. Si ya existía una
 * fila con esa clave, no se toca — ni su estado, ni sus intentos, ni nada
 * — y `encolar` devuelve `{ id: <el de la fila existente>, nuevo: false }`.
 * Esto es a propósito MÁS SIMPLE que "reintentar si la existente falló"
 * (el patrón de `noticeRetryDecision` de otros productos de MAFE
 * Software): acá el REINTENTO de un mensaje que falló lo maneja
 * `procesarOutbox` sobre la MISMA fila (con su propio `intentos`/backoff),
 * nunca insertando una fila nueva — `encolar` con la misma clave
 * simplemente no interfiere con eso.
 *
 * **Valida las opciones ANTES de tocar la base** (sin ida y vuelta):
 * `tenantId`/`destino`/`plantilla`/`claveIdempotencia` no pueden estar
 * vacíos, `canal` tiene que ser `"correo"` o `"whatsapp"`, `maxIntentos`
 * (si se pasa) tiene que ser un entero `>= 1`, `programadoPara` (si se
 * pasa) tiene que ser un `Date` válido — todo tira
 * `ErrorOutbox("opciones_invalidas")`.
 *
 * ```ts
 * import { encolar } from "@mafesoftware/outbox/drizzle";
 *
 * await db.transaction(async (tx) => {
 *   const pedido = await tx.insert(pedidos).values({ ... }).returning();
 *   const { id, nuevo } = await encolar(tx, outbox, {
 *     tenantId,
 *     canal: "correo",
 *     destino: pedido.emailCliente,
 *     plantilla: "confirmacion_pedido",
 *     datos: { pedidoId: pedido.id, total: pedido.total },
 *     claveIdempotencia: `confirmacion-pedido-${pedido.id}`,
 *   });
 *   // nuevo === false si esta función corrió dos veces para el mismo pedido
 *   // (un reintento de la request, por ejemplo) — el aviso se encola una sola vez.
 * });
 *
 * // Agendado: no se manda antes de mañana a las 9.
 * await encolar(tx, outbox, {
 *   tenantId, canal: "whatsapp", destino: "5491122334455", plantilla: "recordatorio_turno",
 *   datos: { turno: "2026-09-25T09:00:00Z" }, claveIdempotencia: `recordatorio-turno-${turnoId}`,
 *   programadoPara: new Date("2026-09-25T09:00:00Z"),
 * });
 * ```
 */
export async function encolar(tx: DbCliente, tabla: TablaOutbox, opciones: OpcionesEncolar): Promise<ResultadoEncolar> {
  if (typeof opciones.tenantId !== "string" || !opciones.tenantId.trim()) {
    throw new ErrorOutbox("opciones_invalidas", 'encolar: "tenantId" no puede estar vacío.');
  }
  if (!CANALES_VALIDOS.includes(opciones.canal)) {
    throw new ErrorOutbox("opciones_invalidas", `encolar: "canal" tiene que ser "correo" o "whatsapp" (fue ${JSON.stringify(opciones.canal)}).`);
  }
  if (typeof opciones.destino !== "string" || !opciones.destino.trim()) {
    throw new ErrorOutbox("opciones_invalidas", 'encolar: "destino" no puede estar vacío.');
  }
  if (typeof opciones.plantilla !== "string" || !opciones.plantilla.trim()) {
    throw new ErrorOutbox("opciones_invalidas", 'encolar: "plantilla" no puede estar vacía.');
  }
  if (typeof opciones.claveIdempotencia !== "string" || !opciones.claveIdempotencia.trim()) {
    throw new ErrorOutbox("opciones_invalidas", 'encolar: "claveIdempotencia" no puede estar vacía.');
  }
  // 200, no 256: MensajeParaEnviar.claveIdempotencia compone
  // "${tenantId}:${claveIdempotencia}" (ver transporte.ts) y ESO es lo que
  // transporteCorreo manda como header Idempotency-Key a Resend, que lo
  // limita a 256 caracteres. Un tenantId uuid + ":" son 37; 200 deja margen
  // de sobra incluso para un tenantId más largo que un uuid.
  if (opciones.claveIdempotencia.length > 200) {
    throw new ErrorOutbox(
      "opciones_invalidas",
      `encolar: "claveIdempotencia" no puede tener más de 200 caracteres (tiene ${opciones.claveIdempotencia.length}) — junto con "tenantId" forma la clave de idempotencia que se le manda al proveedor (Resend limita el header Idempotency-Key a 256 caracteres).`,
    );
  }
  if (opciones.maxIntentos !== undefined && (!Number.isInteger(opciones.maxIntentos) || opciones.maxIntentos < 1)) {
    throw new ErrorOutbox("opciones_invalidas", `encolar: "maxIntentos" tiene que ser un entero >= 1 (fue ${opciones.maxIntentos}).`);
  }
  if (opciones.programadoPara !== undefined && Number.isNaN(opciones.programadoPara.getTime())) {
    throw new ErrorOutbox("opciones_invalidas", 'encolar: "programadoPara" no es una fecha válida.');
  }

  exigirTransaccion(tx);

  const colTenant = sql.identifier(tabla.tenantId.name);
  const colCanal = sql.identifier(tabla.canal.name);
  const colDestino = sql.identifier(tabla.destino.name);
  const colPlantilla = sql.identifier(tabla.plantilla.name);
  const colDatos = sql.identifier(tabla.datos.name);
  const colClaveIdem = sql.identifier(tabla.claveIdempotencia.name);
  const colMaxIntentos = sql.identifier(tabla.maxIntentos.name);
  const colProgramadoPara = sql.identifier(tabla.programadoPara.name);
  const colId = sql.identifier(tabla.id.name);

  const datosParametro = JSON.stringify(opciones.datos ?? {});
  // `null` cuando no se pasó: sentinel para que el `coalesce(...)` de abajo
  // caiga al default (`5`) — mismo patrón (y mismo motivo del cast
  // explícito dentro del `coalesce`, ver `configurarNumerador` de
  // `@mafesoftware/numeradores/drizzle`) que evita que Postgres infiera el
  // tipo del parámetro a partir del literal vecino.
  const maxIntentosParametro: number | null = opciones.maxIntentos ?? null;
  // A diferencia de `maxIntentos`, acá NO se deja que Postgres ponga el
  // default (`now()` del lado del servidor) cuando no se pasa: se calcula
  // en JS (`new Date()`) ANTES de armar la consulta. Es a propósito — ver
  // "Reloj: JS, no de Postgres" en el JSDoc de `tablaOutbox`: la consulta
  // de reclamo de `procesarOutbox` compara `programado_para` contra su
  // propio `ahora()` (también JS, inyectable), y la app y Postgres pueden
  // correr en máquinas/contenedores con relojes que no están
  // perfectamente alineados entre sí (incluso con NTP, la sincronización
  // nunca es exacta). Calculando `programado_para` acá con el reloj de JS,
  // la comparación de `procesarOutbox` (`programado_para <= ahora`) usa el
  // MISMO reloj de los dos lados, sin importar qué tan sincronizado esté
  // el reloj de Postgres.
  const programadoParaParametro: Date = opciones.programadoPara ?? new Date();

  const insercion = sql`
    insert into ${tabla} (${colTenant}, ${colCanal}, ${colDestino}, ${colPlantilla}, ${colDatos}, ${colClaveIdem}, ${colMaxIntentos}, ${colProgramadoPara})
    values (
      ${opciones.tenantId}, ${opciones.canal}, ${opciones.destino}, ${opciones.plantilla}, ${datosParametro},
      ${opciones.claveIdempotencia},
      coalesce(${maxIntentosParametro}::integer, 5::integer),
      ${programadoParaParametro}::timestamptz
    )
    on conflict (${colTenant}, ${colClaveIdem}) do nothing
    returning ${colId} as id
  `;

  const insertado = (await tx.execute(insercion)) as unknown as { rows: FilaId[] };
  const filaInsertada = insertado.rows[0];
  if (filaInsertada) {
    return { id: filaInsertada.id, nuevo: true };
  }

  // Hubo conflicto: la fila YA existía. `ON CONFLICT DO NOTHING` no la
  // devuelve, así que se busca por la misma clave para dar su `id`.
  const busqueda = sql`
    select ${colId} as id from ${tabla}
    where ${colTenant} = ${opciones.tenantId} and ${colClaveIdem} = ${opciones.claveIdempotencia}
  `;
  const existente = (await tx.execute(busqueda)) as unknown as { rows: FilaId[] };
  const filaExistente = existente.rows[0];
  if (!filaExistente) {
    // No debería pasar nunca: el INSERT chocó contra ALGUNA fila con esta
    // misma clave (si no, no habría conflicto), así que tiene que existir.
    // Si llega acá es un bug de esta función, no un caso de negocio.
    throw new Error("encolar: hubo conflicto pero no se encontró la fila existente (no debería pasar)");
  }
  return { id: filaExistente.id, nuevo: false };
}
