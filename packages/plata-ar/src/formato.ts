import type { Moneda } from "./moneda.js";

function agruparMiles(digitos: string, separador: string): string {
  if (separador === "" || digitos.length <= 3) return digitos;
  const grupos: string[] = [];
  let resto = digitos;
  while (resto.length > 3) {
    grupos.unshift(resto.slice(-3));
    resto = resto.slice(0, -3);
  }
  grupos.unshift(resto);
  return grupos.join(separador);
}

/**
 * Formatea un monto en centavos (`bigint`) con moneda, sin la pérdida de
 * precisión de pasar por `Number(centavos) / 100` — que redondea mal apenas
 * el monto cruza `Number.MAX_SAFE_INTEGER` centavos.
 *
 * Arma la parte entera y la fraccionaria con aritmética `bigint` exacta (los
 * dígitos nunca pasan por un `number`), y le pide a `Intl.NumberFormat`
 * *solo* los adornos del locale/moneda —símbolo, su posición, separador de
 * miles y decimal— formateando un valor de referencia chico (nunca el monto
 * real) y reemplazando sus dígitos por los nuestros.
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

  const formateador = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: moneda,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });

  // Valor de referencia (NUNCA el monto real, que puede exceder lo que un
  // `number` representa exacto): solo para leer del locale el símbolo, su
  // posición y los separadores de miles/decimal.
  const partes = formateador.formatToParts(negativo ? -1234 : 1234);
  const separadorDeGrupo = partes.find((p) => p.type === "group")?.value ?? "";
  const enteroFormateado = agruparMiles(enteroTexto, separadorDeGrupo);

  let resultado = "";
  let enteroEmitido = false;
  for (const parte of partes) {
    if (parte.type === "integer" || parte.type === "group") {
      if (!enteroEmitido) {
        resultado += enteroFormateado;
        enteroEmitido = true;
      }
      continue;
    }
    if (parte.type === "fraction") {
      // Solo aparece cuando `decimales > 0`: así se construyó `formateador`
      // (`minimumFractionDigits`/`maximumFractionDigits` = `decimales`).
      resultado += fraccionTexto;
      continue;
    }
    if (parte.type === "decimal") {
      resultado += parte.value;
      continue;
    }
    resultado += parte.value;
  }
  return resultado;
}
