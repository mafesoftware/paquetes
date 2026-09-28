import { redondearComercial } from "@mafesoftware/plata-ar";
import { analizarDecimal } from "./decimal.js";

/** Entrada de `aplicarTope`. */
export interface OpcionesAplicarTope {
  /** El % de `montoBase` ya ajustado en períodos anteriores (acumulado), como decimal humano: `"12.5"` es 12,5%. */
  ajusteAcumuladoPct: string;
  /** El tope del contrato, mismo formato que `ajusteAcumuladoPct`. */
  topePct: string;
  /** El ajuste que se quiere aplicar AHORA (puede ser negativo: deflación). */
  ajusteNuevo: bigint;
  /** El monto base sobre el que se calculan los porcentajes. */
  montoBase: bigint;
}

/** Lo que devuelve `aplicarTope`. */
export interface ResultadoAplicarTope {
  /** La parte de `ajusteNuevo` que efectivamente se aplica. */
  ajusteAplicado: bigint;
  /** La parte que el tope NO deja pasar — "absorbida por la desarrolladora" (spec 02 §3.2). Siempre `>= 0`. */
  excedenteAbsorbido: bigint;
}

/**
 * Aplica el tope opcional de un contrato (spec 02 §3.2: "el ajuste no supera
 * X% acumulado; el exceso queda registrado como absorbido por la
 * desarrolladora"): cuánto de `ajusteNuevo` cabe todavía antes de que el
 * acumulado (`ajusteAcumuladoPct` + lo nuevo) supere `topePct` de
 * `montoBase`.
 *
 * **El tope solo limita hacia ARRIBA.** Un `ajusteNuevo <= 0` (deflación o
 * corrección hacia abajo) nunca lo absorbe — spec 02 §3.2 trata el tope y el
 * ajuste negativo como reglas independientes, y capar un crédito al cliente
 * no tendría sentido de negocio.
 *
 * @example
 * // Tope 15%, ya se aplicó 12% acumulado, se pide un ajuste nuevo de $50.000
 * // sobre una base de $1.000.000 (5% más -> pasaría del tope):
 * aplicarTope({ ajusteAcumuladoPct: "12", topePct: "15", ajusteNuevo: 5_000_000n, montoBase: 100_000_000n });
 * // límite: 15% de 100_000_000 = 15_000_000; ya aplicado: 12% = 12_000_000;
 * // disponible: 3_000_000 -> { ajusteAplicado: 3_000_000n, excedenteAbsorbido: 2_000_000n }
 * @example
 * aplicarTope({ ajusteAcumuladoPct: "0", topePct: "15", ajusteNuevo: -500_000n, montoBase: 100_000_000n });
 * // ajuste negativo: pasa entero, el tope no lo toca.
 * // { ajusteAplicado: -500_000n, excedenteAbsorbido: 0n }
 */
export function aplicarTope(opciones: OpcionesAplicarTope): ResultadoAplicarTope {
  const { ajusteAcumuladoPct, topePct, ajusteNuevo, montoBase } = opciones;

  if (ajusteNuevo <= 0n) {
    return { ajusteAplicado: ajusteNuevo, excedenteAbsorbido: 0n };
  }

  const limite = pctDeMonto(topePct, montoBase, "aplicarTope: topePct");
  const yaAplicado = pctDeMonto(ajusteAcumuladoPct, montoBase, "aplicarTope: ajusteAcumuladoPct");
  const disponible = limite - yaAplicado;

  if (disponible <= 0n) {
    return { ajusteAplicado: 0n, excedenteAbsorbido: ajusteNuevo };
  }
  if (ajusteNuevo <= disponible) {
    return { ajusteAplicado: ajusteNuevo, excedenteAbsorbido: 0n };
  }
  return { ajusteAplicado: disponible, excedenteAbsorbido: ajusteNuevo - disponible };
}

/** `pct`% de `montoBase`, redondeado comercial al centavo. Exacto en `bigint`: `pct` nunca pasa por `number`. */
function pctDeMonto(pct: string, montoBase: bigint, contexto: string): bigint {
  const d = analizarDecimal(pct, contexto);
  const numerador = (d.negativo ? -montoBase : montoBase) * d.valorAbs;
  const denominador = 10n ** BigInt(d.escala + 2); // +2: "%" es /100.
  return redondearComercial(numerador, denominador);
}

/**
 * `ajuste` si es positivo, `0n` si no. Para mostrar "cuánto subió" sin que
 * una deflación se lea como una suba negativa en una pantalla que solo
 * espera subas (spec 02 §3.2: "solo ajusta hacia arriba" es una opción del
 * contrato, no el default — esta función es la pieza chica que la
 * implementa donde haga falta, no una validación general).
 *
 * @example
 * soloPositivo(50_000n); // 50_000n
 * @example
 * soloPositivo(-50_000n); // 0n
 */
export function soloPositivo(ajuste: bigint): bigint {
  return ajuste > 0n ? ajuste : 0n;
}
