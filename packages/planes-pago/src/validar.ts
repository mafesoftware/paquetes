/**
 * Validación de un plan de pago: que la suma de lo pactado en cada condición
 * (anticipo, cuotas, entrega final...) cierre EXACTO contra el valor total
 * acordado — ni un centavo de diferencia. Cuando una condición está en otra
 * moneda que el valor total, se convierte con el tipo de cambio pactado
 * antes de sumar.
 */
import { convertir, redondearComercial, sumar, type Importe } from "@mafesoftware/plata-ar";
import type { Condicion } from "./generar.js";

export type ResultadoValidacion = { ok: true } | { ok: false; diferencia: Importe };

/**
 * Escala de los factores/TC: 8 decimales, la misma que usa `plata-ar` para
 * sus factores. `plata-ar` no exporta su `ESCALA_FACTOR`/`factorAEscala`
 * internos (son detalle de implementación de `aplicarFactor`/`convertir`),
 * así que se replican acá SOLO para la conversión inversa (moneda B → moneda
 * pactada) que `convertir` no ofrece — ver `convertirPorTc`.
 */
const ESCALA_TC = 100_000_000n; // 10^8

/** Igual al parseo de un factor de `aplicarFactor`: decimal de hasta 8 decimales. */
function tcAEscala(tc: string): bigint {
  const coincidencia = /^(-?)(\d+)(?:\.(\d{1,8}))?$/.exec(tc.trim());
  if (!coincidencia) {
    throw new Error(`tipo de cambio inválido: "${tc}" (se espera un decimal de hasta 8 decimales)`);
  }
  // Los grupos 1 (signo) y 2 (entero) siempre matchean si `coincidencia` no
  // es null; solo el grupo 3 (decimales) es opcional.
  const signo = coincidencia[1];
  const entero = coincidencia[2]!;
  const decimales = (coincidencia[3] ?? "").padEnd(8, "0");
  const magnitud = BigInt(entero) * ESCALA_TC + BigInt(decimales);
  return signo === "-" ? -magnitud : magnitud;
}

/**
 * Convierte `importe` a `aMoneda` con `tcPactado`, el tipo de cambio con el
 * que se cerró el plan — que se expresa siempre como "moneda A por moneda
 * B" en el mismo sentido con el que se pactó. `convertir` de `plata-ar` solo
 * sabe MULTIPLICAR por `tc`, que es correcto para ir de moneda B a moneda A
 * pero no al revés. Invertir el TC como string ("0.001") perdería precisión
 * al redondearlo a 8 decimales de nuevo; en cambio, se divide exacto en
 * bigint con `redondearComercial`, igual que hace `aplicarFactor` puertas
 * adentro pero en el sentido inverso.
 *
 * La convención asumida acá es ARS/USD (la más común en la región): de ARS
 * a USD se divide, de USD a ARS (o cualquier otro par) se delega en
 * `convertir`.
 */
function convertirPorTc(importe: Importe, aMoneda: Importe["moneda"], tcPactado: string): Importe {
  if (importe.moneda === "ARS" && aMoneda === "USD") {
    return { centavos: redondearComercial(importe.centavos * ESCALA_TC, tcAEscala(tcPactado)), moneda: "USD" };
  }
  return convertir(importe, aMoneda, tcPactado);
}

/**
 * `tcPactado` es obligatorio en cuanto UNA condición esté en una moneda
 * distinta de `valorCerrado.moneda` — sin él no hay forma de convertir, y
 * eso es un error de quien arma el plan (le falta el tipo de cambio
 * pactado), no un dato de formulario: tira, como el resto de las
 * conversiones de `plata-ar`.
 */
export function validarPlan(
  valorCerrado: Importe,
  condiciones: readonly Condicion[],
  tcPactado?: string,
): ResultadoValidacion {
  const partes: Importe[] = condiciones.map((c) => {
    const importe: Importe = { centavos: c.total, moneda: c.moneda };
    if (c.moneda === valorCerrado.moneda) return importe;
    if (tcPactado === undefined) {
      throw new Error(
        `condición "${c.concepto}" en ${c.moneda} no se puede validar contra ${valorCerrado.moneda} sin tcPactado`,
      );
    }
    return convertirPorTc(importe, valorCerrado.moneda, tcPactado);
  });

  const total = partes.length > 0 ? sumar(...partes) : { centavos: 0n, moneda: valorCerrado.moneda };
  const diferenciaCentavos = total.centavos - valorCerrado.centavos;

  if (diferenciaCentavos === 0n) return { ok: true };
  return { ok: false, diferencia: { centavos: diferenciaCentavos, moneda: valorCerrado.moneda } };
}
