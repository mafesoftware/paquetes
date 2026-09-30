/**
 * Transferencias entre cajas/cuentas, incluidas las que cambian de moneda
 * (tipo de cambio implícito) y su exclusión del cashflow operativo.
 */

import { redondearComercial } from "@mafesoftware/plata-ar";

/**
 * Marca que llevan `categoriaCashflow` de los movimientos que genera una
 * transferencia interna: una transferencia entre cajas propias no es un
 * ingreso ni un egreso real, así que queda afuera de cualquier cashflow
 * operativo que se arme a partir de las categorías de los movimientos.
 */
export const CATEGORIA_TRANSFERENCIA = "transferencia_interna";

/** ¿Este movimiento (por su categoría) es una transferencia interna, y por eso queda afuera del cashflow real? */
export function esTransferenciaInterna(categoriaCashflow: string): boolean {
  return categoriaCashflow === CATEGORIA_TRANSFERENCIA;
}

/**
 * TC implícito de una transferencia con cambio de moneda: `importeOrigen /
 * importeDestino`, como decimal de 6 dígitos, redondeado medio hacia arriba
 * al sexto decimal (`redondearComercial` de `@mafesoftware/plata-ar`).
 *
 * @example
 * tcImplicito(153_500_000n, 100_000n); // "1535.000000" (1.535.000 origen / 1.000 destino)
 */
export function tcImplicito(importeOrigenCentavos: bigint, importeDestinoCentavos: bigint): string {
  if (importeDestinoCentavos <= 0n) {
    throw new Error("El importe destino tiene que ser mayor a 0 para calcular el TC implícito.");
  }
  const ESCALA = 1_000_000n; // 6 decimales
  const escalado = redondearComercial(importeOrigenCentavos * ESCALA, importeDestinoCentavos);
  const entero = escalado / ESCALA;
  const decimales = (escalado % ESCALA).toString().padStart(6, "0");
  return `${entero}.${decimales}`;
}
