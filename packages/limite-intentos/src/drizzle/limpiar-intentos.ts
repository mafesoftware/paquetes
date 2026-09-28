import { eq } from "drizzle-orm";
import { ErrorLimiteIntentos } from "../errores.js";
import type { DbCliente } from "./cliente.js";
import type { TablaIntentos } from "./tabla.js";

/**
 * Borra la fila de `clave` — se llama cuando el intento SALIÓ BIEN (login
 * correcto), para que la cuenta/IP arranque limpia la próxima vez que
 * alguien se equivoque. Si la clave no tenía fila (nunca falló, o ya estaba
 * limpia), no hace nada — no es un error volver a limpiar una clave ya
 * limpia.
 *
 * A propósito, este paquete NO limpia la IP automáticamente cuando limpia
 * la cuenta (a diferencia de la cuenta, una IP puede tener MUCHAS cuentas
 * detrás — limpiarla porque UNA de ellas entró bien dejaría a las demás sin
 * protección de esa IP): quien llama decide si también quiere limpiar
 * `claveIp(ip)`, llamando a esta función una segunda vez con esa clave.
 *
 * ```ts
 * import { limpiarIntentos } from "@mafesoftware/limite-intentos/drizzle";
 * import { claveCuenta } from "@mafesoftware/limite-intentos";
 *
 * // Login correcto: limpia el contador de la cuenta (no el de la IP).
 * await limpiarIntentos(db, limiteIntentos, claveCuenta(email));
 * ```
 */
export async function limpiarIntentos(db: DbCliente, tabla: TablaIntentos, clave: string): Promise<void> {
  if (typeof clave !== "string" || !clave.trim()) {
    throw new ErrorLimiteIntentos("opciones_invalidas", 'limpiarIntentos: "clave" no puede estar vacía.');
  }
  await db.delete(tabla).where(eq(tabla.clave, clave));
}
