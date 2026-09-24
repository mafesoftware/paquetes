/**
 * Autorización de un cron (de Vercel o de lo que sea): header
 * `Authorization: Bearer <secreto>`.
 *
 * **Falla cerrado.** Si `secreto` no está configurado (`undefined` o `""`),
 * devuelve `false` — nunca "como no hay secreto, dejo pasar". La alternativa
 * (comparar contra `undefined` o contra `""`) deja el cron abierto en
 * cualquier ambiente donde alguien se olvidó de poner la variable de
 * entorno, que es exactamente el ambiente donde nadie se va a dar cuenta.
 */
import { compararEnTiempoConstante } from "../comparar.js";

export function autorizarCron(req: Request, secreto: string | undefined): boolean {
  if (!secreto) return false;
  const cabecera = req.headers.get("authorization");
  if (!cabecera) return false;
  return compararEnTiempoConstante(cabecera, `Bearer ${secreto}`);
}
