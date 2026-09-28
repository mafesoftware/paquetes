import { ErrorLimiteIntentos } from "./errores.js";

/**
 * La clave de una CUENTA (típicamente un email): normaliza espacios y
 * mayúsculas antes de prefijar, para que `"  Ana@Club.com "` y
 * `"ana@club.com"` cuenten como la MISMA cuenta — si no, alguien podría
 * evadir el freno variando mayúsculas o espacios en cada intento.
 *
 * El prefijo (`"cuenta:"`) es lo que mantiene esta clave en su propio
 * espacio de nombres, separado de `claveIp` — el mismo texto nunca podría
 * chocar entre las dos.
 *
 * ```ts
 * import { claveCuenta } from "@mafesoftware/limite-intentos";
 *
 * claveCuenta("  Ana@Club.com "); // "cuenta:ana@club.com"
 * ```
 */
export function claveCuenta(email: string): string {
  if (typeof email !== "string" || !email.trim()) {
    throw new ErrorLimiteIntentos("opciones_invalidas", 'claveCuenta: "email" no puede estar vacío.');
  }
  return `cuenta:${email.trim().toLowerCase()}`;
}

/**
 * La clave de una IP. A diferencia de `claveCuenta`, NO baja a minúsculas
 * (una IPv4/IPv6 no gana nada normalizando el caso, y este paquete no
 * pretende canonicalizar direcciones IP) — solo recorta espacios y prefija,
 * para que quede en su propio espacio de nombres (`"ip:"`), separado de
 * `claveCuenta`.
 *
 * ```ts
 * import { claveIp } from "@mafesoftware/limite-intentos";
 *
 * claveIp("203.0.113.7"); // "ip:203.0.113.7"
 * ```
 */
export function claveIp(ip: string): string {
  if (typeof ip !== "string" || !ip.trim()) {
    throw new ErrorLimiteIntentos("opciones_invalidas", 'claveIp: "ip" no puede estar vacía.');
  }
  return `ip:${ip.trim()}`;
}
