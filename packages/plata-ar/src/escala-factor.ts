import { ErrorPlata } from "./errores.js";

/**
 * Escala de los factores: 8 decimales (spec 02 §1 y §3, `numeric(20,8)`).
 *
 * Módulo **interno**, deliberadamente NO re-exportado desde `index.ts`
 * (a diferencia de una versión anterior, que lo dejaba en `factor.ts` y
 * `export * from "./factor.js"` lo filtraba a la API pública sin querer):
 * es un detalle de implementación de `aplicarFactor`/`convertir`, no algo
 * que un consumidor del paquete necesite tocar directo.
 */
export const ESCALA_FACTOR = 100_000_000n; // 10^8

/**
 * Un FACTOR decimal string ("1.06203057", hasta 8 decimales — spec 02 §1:
 * "los factores intermedios se guardan con 8 decimales") a un entero
 * escalado por 10^8, exacto.
 *
 * Distinto de un valor de ÍNDICE (ver `factorEntre` en `factor.ts`, que
 * acepta cualquier cantidad de decimales): esto es específicamente el
 * formato que espera `aplicarFactor`, ya reducido a la razón final.
 */
export function factorAEscala(factor: string): bigint {
  const texto = factor.trim();
  const coincidencia = /^(-?)(\d+)(?:\.(\d{1,8}))?$/.exec(texto);
  if (!coincidencia) {
    throw new ErrorPlata(
      "factor_invalido",
      `Factor inválido: "${factor}" (se espera un decimal de hasta 8 decimales, ej. "1.06203057").`,
    );
  }
  // Los grupos 1 y 2 siempre matchean si `coincidencia` no es null (no son
  // opcionales en el regex); solo el grupo 3 (decimales) es opcional.
  const signo = coincidencia[1]!;
  const entero = coincidencia[2]!;
  const decimales = (coincidencia[3] ?? "").padEnd(8, "0");
  const magnitud = BigInt(entero) * ESCALA_FACTOR + BigInt(decimales);
  return signo === "-" ? -magnitud : magnitud;
}
