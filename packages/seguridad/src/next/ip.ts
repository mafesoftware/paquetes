/**
 * La IP de quien hace el request, para lo que haga falta (rate limiting,
 * auditoría). Detrás de un proxy/CDN (Vercel incluido) el socket TCP es del
 * proxy, no del cliente — la IP real viaja en un header.
 *
 * `x-forwarded-for` puede traer una cadena de proxies (`cliente, proxy1,
 * proxy2`): el primero es el más cercano al cliente original. `x-real-ip` es
 * el respaldo de proxies que no arman la cadena. Ninguno de los dos es
 * infalsificable —cualquiera puede mandar estos headers—, así que esto sirve
 * para lo que no exige certeza; con Vercel, que sobrescribe `x-forwarded-for`
 * en su borde, alcanza.
 */
export function ipDe(headers: Headers): string | null {
  const reenviada = headers.get("x-forwarded-for");
  if (reenviada) {
    const primera = reenviada.split(",")[0]?.trim();
    if (primera) return primera;
  }
  const real = headers.get("x-real-ip");
  if (real) {
    const limpia = real.trim();
    if (limpia) return limpia;
  }
  return null;
}
