import { ErrorPlata } from "./errores.js";

/** El peso de una parte: `bigint`, `number` o un string decimal ("33.33"). */
export type PesoReparto = bigint | number | string;

interface PesoAnalizado {
  negativo: boolean;
  entero: string;
  decimales: string;
}

/**
 * Expande la notación exponencial que `Number.prototype.toString` usa para
 * magnitudes muy chicas (`< 1e-6`) o muy grandes (`>= 1e21`, ver ECMA-262
 * `Number::toString`) a notación decimal plana, moviendo el punto sobre los
 * mismos dígitos que ya imprimió `toString` — no reconstruye el valor desde
 * los bits IEEE-754, así que un decimal "de toda la vida" como `33.33`
 * (cuyo `toString` nunca usa notación exponencial) sale intacto, sin la
 * expansión binaria completa (~50 dígitos) que tendría bit a bit. Un
 * `number` sin notación exponencial en su `toString` vuelve sin cambios.
 */
function expandirNotacionExponencial(texto: string): string {
  const coincidencia = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(texto);
  if (!coincidencia) return texto;

  const signo = coincidencia[1] ?? "";
  const parteEntera = coincidencia[2]!;
  const parteDecimal = coincidencia[3] ?? "";
  const exponente = Number(coincidencia[4]!);

  const digitos = parteEntera + parteDecimal;
  const puntoNuevo = parteEntera.length + exponente;

  let cuerpo: string;
  if (puntoNuevo <= 0) {
    cuerpo = `0.${"0".repeat(-puntoNuevo)}${digitos}`;
  } else if (puntoNuevo >= digitos.length) {
    cuerpo = digitos + "0".repeat(puntoNuevo - digitos.length);
  } else {
    cuerpo = `${digitos.slice(0, puntoNuevo)}.${digitos.slice(puntoNuevo)}`;
  }
  if (cuerpo.includes(".")) {
    cuerpo = cuerpo.replace(/0+$/, "").replace(/\.$/, "");
  }
  return signo + cuerpo;
}

function analizarPeso(peso: PesoReparto): PesoAnalizado {
  let texto: string;
  if (typeof peso === "bigint") {
    texto = peso.toString();
  } else if (typeof peso === "number") {
    if (!Number.isFinite(peso)) {
      throw new ErrorPlata("peso_invalido", `Peso inválido: ${String(peso)}.`);
    }
    texto = expandirNotacionExponencial(peso.toString());
  } else {
    texto = peso.trim();
  }

  const coincidencia = /^(-?)(\d+)(?:\.(\d+))?$/.exec(texto);
  if (!coincidencia) {
    throw new ErrorPlata("peso_invalido", `Peso inválido: "${String(peso)}".`);
  }

  const entero = coincidencia[2]!;
  const decimales = coincidencia[3] ?? "";
  // "-0" (o "-0.00", "-0.0", ...) es cero, no negativo: no hay signo
  // posible para "nada" (spec: -0 cuenta como cero).
  const esCero = /^0*$/.test(entero) && (decimales === "" || /^0*$/.test(decimales));
  return {
    negativo: coincidencia[1] === "-" && !esCero,
    entero,
    decimales,
  };
}

/**
 * Reparte `total` centavos entre `pesos` **sin perder ni inventar un
 * centavo**, por mayor resto (spec 02 §1: "la suma de las partes es
 * exactamente el total").
 *
 * Los pesos se usan como proporción, no como monto, y se convierten a
 * enteros exactos (nunca a `number` con parte fraccionaria) antes de
 * calcular: aceptan `bigint`, `number` (incluida notación exponencial, p.ej.
 * `1e-7`) o un string decimal ("33.33"), sin límite de decimales.
 *
 * **Empate en el resto → gana el peso más grande; si los pesos también
 * empatan, gana el índice más bajo** (spec 02 §1: "en prorrateos se asigna
 * por mayor resto; empate: la parte de mayor peso").
 *
 * Tira `ErrorPlata` si `pesos` está vacío, si algún peso es negativo o si
 * todos los pesos son cero: son errores de quien llama, no datos de un
 * formulario (ver `errores.ts`).
 *
 * @example
 * repartirPorMayorResto(100n, [1, 1, 1]); // [34n, 33n, 33n]
 * @example
 * repartirPorMayorResto(1000n, ["33.33", "33.33", "33.34"]); // [333n, 333n, 334n]
 * @example
 * repartirPorMayorResto(2n, [1, 3]); // [0n, 2n]  (empate en el resto: gana el peso 3)
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

  // Sin spread en Math.max: con listas grandes, `Math.max(...arreglo)` puede
  // superar el límite de argumentos de la pila del motor.
  const maxDecimales = analizados.reduce((max, a) => Math.max(max, a.decimales.length), 0);
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
  const restos: { resto: bigint; peso: bigint; indice: number }[] = [];
  let sumaPartes = 0n;

  pesosEscalados.forEach((peso, indice) => {
    const producto = totalAbsoluto * peso;
    const cociente = producto / sumaPesos;
    const resto = producto % sumaPesos;
    partes[indice] = cociente;
    sumaPartes += cociente;
    restos.push({ resto, peso, indice });
  });

  // Mayor resto primero; empate → gana el peso más grande; empate también
  // en el peso → el índice más bajo.
  restos.sort((a, b) => {
    if (a.resto !== b.resto) return a.resto > b.resto ? -1 : 1;
    if (a.peso !== b.peso) return a.peso > b.peso ? -1 : 1;
    return a.indice - b.indice;
  });

  let faltante = totalAbsoluto - sumaPartes;
  for (let k = 0; faltante > 0n; k = (k + 1) % restos.length, faltante--) {
    const indice = restos[k]!.indice;
    partes[indice] = partes[indice]! + 1n;
  }

  return totalEsNegativo ? partes.map((parte) => -parte) : partes;
}
