/**
 * Búsqueda de combinaciones: dado un objetivo y una lista de candidatos ya
 * filtrados por el llamador (mismo signo que el objetivo, dentro de la
 * ventana de fecha que corresponda), encuentra un subconjunto de 2 a
 * `maxCombinacion` candidatos cuya suma de `importe` coincide exactamente
 * con el objetivo — DFS con poda: al ser todos del mismo signo, la suma
 * parcial es monótona respecto del objetivo, así que se corta apenas la
 * excede en valor absoluto.
 *
 * Se acota a los primeros `LIMITE_CANDIDATOS` recibidos (se espera que el
 * llamador los haya ordenado por cercanía de fecha) para no explotar
 * combinatoriamente con carteras grandes de movimientos sin matchear
 * directo — no es un subset-sum general, es deliberadamente acotado.
 */

const LIMITE_CANDIDATOS = 15;

export function buscarCombinacion(
  objetivo: bigint,
  candidatos: readonly { id: string; importe: bigint }[],
  maxCombinacion: number,
): string[] | null {
  if (maxCombinacion < 2 || objetivo === 0n) return null;

  const acotados = candidatos.slice(0, LIMITE_CANDIDATOS);
  const abs = objetivo < 0n ? -objetivo : objetivo;

  let resultado: string[] | null = null;

  function dfs(desde: number, restante: bigint, elegidos: string[]): boolean {
    if (elegidos.length >= 2 && restante === 0n) {
      resultado = [...elegidos];
      return true;
    }
    if (elegidos.length >= maxCombinacion) return false;

    for (let i = desde; i < acotados.length; i++) {
      const c = acotados[i]!;
      const cAbs = c.importe < 0n ? -c.importe : c.importe;
      if (cAbs > restante) continue; // poda: mismo signo, nunca se pasa

      elegidos.push(c.id);
      if (dfs(i + 1, restante - cAbs, elegidos)) return true;
      elegidos.pop();
    }
    return false;
  }

  dfs(0, abs, []);
  return resultado;
}
