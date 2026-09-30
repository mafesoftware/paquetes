/**
 * Prorrateo de un documento "general" entre proyectos: los pesos son
 * PORCENTAJES que tienen que sumar 100, y el reparto en sí (mayor resto)
 * delega ÍNTEGRAMENTE en `repartirPorMayorResto` de `@mafesoftware/plata-ar`
 * — no se reimplementa acá. Este archivo solo agrega la validación de
 * negocio propia de un prorrateo por porcentaje. PURA: sin DB.
 */
import { repartirPorMayorResto } from "@mafesoftware/plata-ar";

const TOLERANCIA_PORCENTAJE = 0.01;

/** ¿Los porcentajes (strings decimales) suman 100, con una tolerancia de redondeo de centésimas? */
export function sumaCien(porcentajes: readonly string[]): boolean {
  const suma = porcentajes.reduce((acc, p) => acc + Number(p), 0);
  return Math.abs(suma - 100) <= TOLERANCIA_PORCENTAJE;
}

/**
 * Reparte `totalCentavos` según `porcentajes` (mayor resto): Σ resultado =
 * `totalCentavos`, exacto, sin importar cuántos proyectos ni qué porcentaje
 * tenga cada uno. Los porcentajes se pasan tal cual (como string) a
 * `repartirPorMayorResto`, que los toma como enteros exactos en `bigint` —
 * sin pasar por `number`, así que un porcentaje con más decimales que un
 * `number` no pierde precisión en el camino.
 *
 * @example
 * prorratearPorPorcentaje(10_000n, ["33", "33", "34"]); // Σ === 10_000n
 */
export function prorratearPorPorcentaje(totalCentavos: bigint, porcentajes: readonly string[]): bigint[] {
  return repartirPorMayorResto(totalCentavos, porcentajes);
}
