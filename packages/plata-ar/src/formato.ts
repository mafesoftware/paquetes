import type { Moneda } from "./moneda.js";

/**
 * Formatea un monto en centavos (`bigint`) con moneda, sin la pérdida de
 * precisión de pasar por `Number(centavos) / 100` — que redondea mal apenas
 * el monto cruza `Number.MAX_SAFE_INTEGER` centavos.
 *
 * Arma el valor como un STRING decimal exacto (`enteroTexto.fraccionTexto`,
 * construido con aritmética `bigint`) y se lo pasa directo a
 * `Intl.NumberFormat#format`, que —a diferencia de pasarle un `number`—
 * acepta un string decimal y lo interpreta con precisión matemática exacta
 * (`ToIntlMathematicalValue`, parte del estándar ECMA-402 desde 2020;
 * soportado en los motores JS modernos, Node ≥ 20 incluido). Así `Intl`
 * resuelve símbolo, posición, separador de miles/decimal y agrupamiento
 * **del locale real** (de a 3 en la mayoría, pero irregular en otros como
 * `en-IN`: "₹12,34,567"), sin que este paquete tenga que reimplementar esa
 * lógica a mano asumiendo grupos de a 3 en todos lados — que es lo que
 * hacía una versión anterior de esta función, y que perdía el agrupamiento
 * en `es-ES` (ver test).
 */
export function formatearImporteExacto(
  centavos: bigint,
  moneda: Moneda,
  opciones: { locale?: string; decimalesSiempre?: boolean } = {},
): string {
  const { locale = "es-AR", decimalesSiempre = true } = opciones;
  const negativo = centavos < 0n;
  const absoluto = negativo ? -centavos : centavos;
  const enteroTexto = (absoluto / 100n).toString();
  const fraccionTexto = (absoluto % 100n).toString().padStart(2, "0");
  const decimales = decimalesSiempre || fraccionTexto !== "00" ? 2 : 0;
  const valorDecimal =
    (negativo ? "-" : "") + (decimales > 0 ? `${enteroTexto}.${fraccionTexto}` : enteroTexto);

  const formateador = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: moneda,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });

  // `Intl.NumberFormat#format` acepta `string` en tiempo de ejecución (ver
  // docstring), pero el tipo de `lib.es2020.intl` de TypeScript solo declara
  // `number | bigint` — de ahí el cast.
  return formateador.format(valorDecimal as unknown as number);
}
