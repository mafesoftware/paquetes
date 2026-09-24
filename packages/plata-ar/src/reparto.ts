import { ErrorPlata } from "./errores.js";

/** El peso de una parte: `bigint`, `number` o un string decimal ("33.33"). */
export type PesoReparto = bigint | number | string;

interface PesoAnalizado {
  negativo: boolean;
  entero: string;
  decimales: string;
}

function analizarPeso(peso: PesoReparto): PesoAnalizado {
  let texto: string;
  if (typeof peso === "bigint") {
    texto = peso.toString();
  } else if (typeof peso === "number") {
    if (!Number.isFinite(peso)) {
      throw new ErrorPlata("peso_invalido", `Peso inválido: ${String(peso)}.`);
    }
    texto = peso.toString();
  } else {
    texto = peso.trim();
  }

  const coincidencia = /^(-?)(\d+)(?:\.(\d+))?$/.exec(texto);
  if (!coincidencia) {
    throw new ErrorPlata("peso_invalido", `Peso inválido: "${String(peso)}".`);
  }
  return {
    negativo: coincidencia[1] === "-",
    // El grupo 2 (entero) siempre matchea si `coincidencia` no es null; solo
    // el grupo 3 (decimales) es opcional.
    entero: coincidencia[2]!,
    decimales: coincidencia[3] ?? "",
  };
}

/**
 * Reparte `total` centavos entre `pesos` **sin perder ni inventar un
 * centavo**, por mayor resto (spec 02 §1: "la suma de las partes es
 * exactamente el total"; spec 06 §3: "repartos por mayor resto, no por mayor
 * peso").
 *
 * Los pesos se usan como proporción, no como monto, y se convierten a
 * enteros exactos (nunca a `number` con parte fraccionaria) antes de
 * calcular: aceptan `bigint`, `number` o un string decimal ("33.33"), sin
 * límite de decimales.
 *
 * **Empate en el resto → gana el índice más bajo** (el primero de la
 * lista).
 *
 * Tira `ErrorPlata` si `pesos` está vacío, si algún peso es negativo o si
 * todos los pesos son cero: son errores de quien llama, no datos de un
 * formulario (ver `errores.ts`).
 *
 * @example
 * repartirPorMayorResto(100n, [1, 1, 1]); // [34n, 33n, 33n]
 * @example
 * repartirPorMayorResto(1000n, ["33.33", "33.33", "33.34"]); // [333n, 333n, 334n]
 */
export function repartirPorMayorResto(total: bigint, pesos: readonly PesoReparto[]): bigint[] {
  if (pesos.length === 0) {
    throw new ErrorPlata("pesos_vacio", "repartirPorMayorResto: la lista de pesos no puede estar vacía.");
  }

  const analizados = pesos.map(analizarPeso);
  for (const analizado of analizados) {
    if (analizado.negativo) {
      throw new ErrorPlata("peso_negativo", "repartirPorMayorResto: ningún peso puede ser negativo.");
    }
  }

  const maxDecimales = Math.max(...analizados.map((a) => a.decimales.length));
  const pesosEscalados = analizados.map((a) => {
    const decimalesCompletos = a.decimales.padEnd(maxDecimales, "0");
    const texto = maxDecimales === 0 ? a.entero : `${a.entero}${decimalesCompletos}`;
    return BigInt(texto);
  });

  const sumaPesos = pesosEscalados.reduce((acumulado, peso) => acumulado + peso, 0n);
  if (sumaPesos === 0n) {
    throw new ErrorPlata("pesos_todo_cero", "repartirPorMayorResto: la suma de los pesos no puede ser cero.");
  }

  // Se reparte sobre el valor absoluto y se restaura el signo al final: la
  // proporción de cada parte es la misma repartiendo 100 que repartiendo -100.
  const totalEsNegativo = total < 0n;
  const totalAbsoluto = totalEsNegativo ? -total : total;

  const partes: bigint[] = pesosEscalados.map(() => 0n);
  const restos: { resto: bigint; indice: number }[] = [];
  let sumaPartes = 0n;

  pesosEscalados.forEach((peso, indice) => {
    const producto = totalAbsoluto * peso;
    const cociente = producto / sumaPesos;
    const resto = producto % sumaPesos;
    partes[indice] = cociente;
    sumaPartes += cociente;
    restos.push({ resto, indice });
  });

  // Mayor resto primero; empate → el índice más bajo (spec: "empate → primero").
  restos.sort((a, b) => {
    if (a.resto === b.resto) return a.indice - b.indice;
    return a.resto > b.resto ? -1 : 1;
  });

  let faltante = totalAbsoluto - sumaPartes;
  for (let k = 0; faltante > 0n; k = (k + 1) % restos.length, faltante--) {
    const indice = restos[k]!.indice;
    partes[indice] = partes[indice]! + 1n;
  }

  return totalEsNegativo ? partes.map((parte) => -parte) : partes;
}
