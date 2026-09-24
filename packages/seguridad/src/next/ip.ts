/**
 * La IP de quien hace el request, para lo que haga falta (rate limiting,
 * auditoría). Detrás de un proxy/CDN (Vercel incluido) el socket TCP es del
 * proxy, no del cliente — la IP real viaja en un header.
 *
 * `x-forwarded-for` puede traer una cadena de proxies (`cliente, proxy1,
 * proxy2`): el primero es el más cercano al cliente original. `x-real-ip` es
 * el respaldo de proxies que no arman la cadena.
 *
 * ## Ninguno de los dos es confiable por sí solo (fix round 1, M7)
 *
 * **`x-forwarded-for` lo puede escribir el CLIENTE.** Si tu request no pasa
 * por un proxy/CDN que lo reescriba desde cero (Vercel, en su borde, sí lo
 * hace), un cliente puede mandar `X-Forwarded-For: 1.2.3.4` a mano y
 * `ipDe` va a devolver `"1.2.3.4"` sin que eso tenga nada que ver con su IP
 * real — el header no autentica nada, solo declara. Usar esto para algo más
 * que "una pista para logs/rate-limiting best-effort" (por ejemplo, para una
 * decisión de autorización) es un error: hace falta que LA PLATAFORMA
 * (Vercel, un load balancer propio bien configurado) sea la que sobreescribe
 * el header en su borde, no que confíe en lo que ya traía el request.
 *
 * Lo que SÍ hace esta función: nunca devuelve algo que no tenga forma de
 * IPv4/IPv6 (ver `esDireccionIp` — se apoya en `node:net`, no en un regex
 * propio: las formas válidas de IPv6, sobre todo comprimidas, son demasiadas
 * como para mantener un regex a mano sin bugs). Si el primer valor de
 * `x-forwarded-for` no tiene forma de IP, se prueba `x-real-ip`; si tampoco,
 * `null`. Eso frena basura obvia (un header con un script, una lista vacía,
 * espacios), no una IP FALSA pero bien formada — eso solo lo arregla no
 * confiar en el cliente.
 */
// `node:net` no está disponible en el runtime Edge de Next.js (sí en el
// runtime Node.js, que además es el default para middleware/proxy desde
// Next 15). Si tu proxy corre en Edge, `ipDe` no es el import que necesitás
// desde ahí — es una limitación conocida, no un olvido.
import { isIP } from "node:net";

function esDireccionIp(valor: string): boolean {
  return isIP(valor) !== 0;
}

export function ipDe(headers: Headers): string | null {
  const reenviada = headers.get("x-forwarded-for");
  if (reenviada) {
    const primera = reenviada.split(",")[0]?.trim();
    if (primera && esDireccionIp(primera)) return primera;
  }
  const real = headers.get("x-real-ip");
  if (real) {
    const limpia = real.trim();
    if (limpia && esDireccionIp(limpia)) return limpia;
  }
  return null;
}
