import { eq } from "drizzle-orm";
import { ErrorLimiteIntentos } from "../errores.js";
import type { DbCliente } from "./cliente.js";
import type { TablaIntentos } from "./tabla.js";

/** Opciones de `consultarIntento`. */
export interface OpcionesConsultarIntento {
  /** La clave (PK de la tabla) del sujeto — `claveCuenta(email)` o `claveIp(ip)`. */
  clave: string;
  /** De dónde sale "ahora" — inyectable para tests deterministas. `new Date()` si no se pasa. */
  ahora?: Date;
}

/** Lo que devuelve `consultarIntento`. */
export interface ResultadoConsultarIntento {
  /** Cuántos intentos lleva la ventana actual. `0` si nunca se registró ningún intento para esta clave. */
  contador: number;
  /** Cuándo arrancó la ventana actual, o `null` si nunca se registró ningún intento. */
  ventanaDesde: Date | null;
  /** `true` si, a `ahora`, la clave está bloqueada (`bloqueado_hasta > ahora`). */
  bloqueado: boolean;
  /** Cuándo se destraba, o `null` si no está bloqueada. */
  desbloqueaEn: Date | null;
}

/** El resultado "sin fila" — clave nunca registrada. */
const SIN_FILA: ResultadoConsultarIntento = { contador: 0, ventanaDesde: null, bloqueado: false, desbloqueaEn: null };

/**
 * Lee el estado de `clave` SIN escribir nada — a diferencia de
 * `registrarIntento`, no cuenta como un intento. Pensada para chequear ANTES
 * de intentar autenticar (evita gastar el costo de comparar contraseña con
 * bcrypt/argon2 en una cuenta ya bloqueada) o para mostrar el estado en un
 * panel.
 *
 * No recibe `maximo` (a diferencia de `registrarIntento`): `contador` por sí
 * solo no dice si la clave está bloqueada, así que `bloqueado`/`desbloqueaEn`
 * salen ÚNICAMENTE de comparar `bloqueado_hasta` contra `ahora` — el mismo
 * criterio que usa `registrarIntento` para decidir `permitido`. Si la clave
 * nunca registró ningún intento, devuelve `{ contador: 0, ventanaDesde: null,
 * bloqueado: false, desbloqueaEn: null }` sin tocar la base más que con un
 * `SELECT`.
 *
 * ```ts
 * import { consultarIntento } from "@mafesoftware/limite-intentos/drizzle";
 * import { claveCuenta } from "@mafesoftware/limite-intentos";
 *
 * const { bloqueado, desbloqueaEn } = await consultarIntento(db, limiteIntentos, { clave: claveCuenta(email) });
 * if (bloqueado) {
 *   // "Demasiados intentos, probá de nuevo después de desbloqueaEn" — sin llegar a comparar la contraseña.
 * }
 * ```
 */
export async function consultarIntento(
  db: DbCliente,
  tabla: TablaIntentos,
  opciones: OpcionesConsultarIntento,
): Promise<ResultadoConsultarIntento> {
  if (typeof opciones.clave !== "string" || !opciones.clave.trim()) {
    throw new ErrorLimiteIntentos("opciones_invalidas", 'consultarIntento: "clave" no puede estar vacía.');
  }
  if (opciones.ahora !== undefined && Number.isNaN(opciones.ahora.getTime())) {
    throw new ErrorLimiteIntentos("opciones_invalidas", 'consultarIntento: "ahora" no es una fecha válida.');
  }
  const ahora = opciones.ahora ?? new Date();

  const [fila] = await db
    .select({ contador: tabla.contador, ventanaDesde: tabla.ventanaDesde, bloqueadoHasta: tabla.bloqueadoHasta })
    .from(tabla)
    .where(eq(tabla.clave, opciones.clave))
    .limit(1);

  if (!fila) return SIN_FILA;

  const bloqueadoHasta = fila.bloqueadoHasta as Date | null;
  const bloqueado = bloqueadoHasta !== null && bloqueadoHasta.getTime() > ahora.getTime();

  return {
    contador: fila.contador as number,
    ventanaDesde: fila.ventanaDesde as Date,
    bloqueado,
    desbloqueaEn: bloqueado ? bloqueadoHasta : null,
  };
}
