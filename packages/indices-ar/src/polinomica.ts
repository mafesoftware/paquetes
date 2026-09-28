import { factorEntre, redondearComercial } from "@mafesoftware/plata-ar";
import { ErrorIndices } from "./errores.js";
import { analizarDecimal, formatearDecimal, sumarExacto } from "./decimal.js";

/** Un componente de una fórmula polinómica (spec 02 §3.1): `peso × (actual / base)`. */
export interface ComponentePolinomica {
  /** El peso del componente en la fórmula, decimal humano (`"0.45"` es 45%). La suma de todos tiene que dar 1 (±1e-8). */
  peso: string;
  /** El valor ACTUAL del índice de este componente. */
  actual: string;
  /** El valor BASE (del período base del contrato) de este mismo índice. */
  base: string;
}

/**
 * El valor de una fórmula polinómica (spec 02 §3.1): `Σ peso_i × (índice_i
 * actual / índice_i base)` — por ejemplo, `0.45 × MO + 0.45 × Mat + 0.10 ×
 * GG`, cada término la razón (`factorEntre`, 8 decimales) de ese componente.
 *
 * Devuelve un string decimal de 8 decimales, exacto en `bigint` de punta a
 * punta: cada razón se calcula con `factorEntre` de `plata-ar`, la
 * ponderación y la suma se hacen en aritmética entera exacta (escalando
 * cada decimal a una escala común, nunca por `number`), y el redondeo
 * comercial a 8 decimales pasa una sola vez, al final.
 *
 * **Los pesos tienen que sumar 1, con tolerancia ±1e-8** — si no, tira
 * `ErrorIndices("pesos_no_suman_uno")`: una fórmula cuyos pesos no cierran
 * es casi siempre un error de carga (un componente olvidado, un peso mal
 * tipeado), no un dato de negocio válido. Un peso negativo tira
 * `ErrorIndices("peso_invalido")`. `actual`/`base` inválidos o no positivos
 * los valida `factorEntre` y tira `ErrorPlata("indice_invalido")` — este
 * paquete no reenvuelve esa validación.
 *
 * @example
 * valorPolinomica([
 *   { peso: "0.45", actual: "150", base: "100" },  // 45% x 1.5
 *   { peso: "0.45", actual: "120", base: "100" },  // 45% x 1.2
 *   { peso: "0.10", actual: "110", base: "100" },  // 10% x 1.1
 * ]);
 * // 0.45*1.5 + 0.45*1.2 + 0.10*1.1 = 0.675 + 0.54 + 0.11 = 1.325
 * // "1.325"
 * @example
 * valorPolinomica([{ peso: "0.5", actual: "100", base: "100" }]); // tira ErrorIndices ("pesos_no_suman_uno"): 0.5 != 1
 */
export function valorPolinomica(componentes: readonly ComponentePolinomica[]): string {
  if (componentes.length === 0) {
    throw new ErrorIndices("polinomica_vacia", "valorPolinomica: la lista de componentes no puede estar vacía.");
  }

  let sumaPesos = { valor: 0n, escala: 0 };
  let sumaPonderada = { valor: 0n, escala: 0 };

  for (const componente of componentes) {
    const peso = analizarDecimal(componente.peso, "valorPolinomica: peso");
    if (peso.negativo) {
      throw new ErrorIndices(
        "peso_invalido",
        `valorPolinomica: el peso "${componente.peso}" no puede ser negativo.`,
      );
    }

    sumaPesos = sumarExacto(sumaPesos, { valor: peso.valorAbs, escala: peso.escala });

    const factor = factorEntre(componente.actual, componente.base); // "X.YYYYYYYY", hasta 8 decimales, siempre positivo
    const factorDecimal = analizarDecimal(factor, "valorPolinomica: factor");

    const productoValor = peso.valorAbs * factorDecimal.valorAbs; // peso siempre >= 0 acá
    const productoEscala = peso.escala + factorDecimal.escala;

    sumaPonderada = sumarExacto(sumaPonderada, { valor: productoValor, escala: productoEscala });
  }

  validarPesosSuman1(sumaPesos);

  return formatearRedondeado8(sumaPonderada.valor, sumaPonderada.escala);
}

/** La tolerancia de spec: ±1e-8 alrededor de 1. */
const ESCALA_TOLERANCIA = 8;

function validarPesosSuman1(sumaPesos: { valor: bigint; escala: number }): void {
  const escalaComun = Math.max(sumaPesos.escala, ESCALA_TOLERANCIA);
  const sumaEscalada = sumaPesos.valor * 10n ** BigInt(escalaComun - sumaPesos.escala);
  const unoEscalado = 10n ** BigInt(escalaComun);
  const toleranciaEscalada = 10n ** BigInt(escalaComun - ESCALA_TOLERANCIA);

  const diferencia = sumaEscalada > unoEscalado ? sumaEscalada - unoEscalado : unoEscalado - sumaEscalada;
  if (diferencia > toleranciaEscalada) {
    throw new ErrorIndices(
      "pesos_no_suman_uno",
      `valorPolinomica: los pesos suman ${formatearDecimal(sumaPesos.valor, sumaPesos.escala)}, no 1 (tolerancia ±1e-8).`,
    );
  }
}

/** Redondea comercial un decimal exacto (`valor` a `escala` decimales) a EXACTAMENTE 8 decimales, formateado sin ceros de más. */
function formatearRedondeado8(valor: bigint, escala: number): string {
  if (escala === ESCALA_TOLERANCIA) return formatearDecimal(valor, ESCALA_TOLERANCIA);
  if (escala > ESCALA_TOLERANCIA) {
    const redondeado = redondearComercial(valor, 10n ** BigInt(escala - ESCALA_TOLERANCIA));
    return formatearDecimal(redondeado, ESCALA_TOLERANCIA);
  }
  const escalado = valor * 10n ** BigInt(ESCALA_TOLERANCIA - escala);
  return formatearDecimal(escalado, ESCALA_TOLERANCIA);
}
