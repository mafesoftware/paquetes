/**
 * Interés por mora sobre un saldo vencido, y aging (bandas de días de
 * atraso).
 *
 * Interés simple: `saldo × tasa/365 × días de atraso`, con:
 * - **Gracia** (`diasGracia`): los primeros N días desde `desde` no generan
 *   interés — equivale a correr el inicio del período `diasGracia` días.
 * - **Tramos**: la tasa vigente puede cambiar dentro del período; el
 *   interés total es la suma exacta de cada sub-período al tramo de tasa
 *   que le corresponde.
 *
 * El redondeo (medio hacia arriba, `redondearComercial` de
 * `@mafesoftware/plata-ar`) se aplica UNA sola vez, sobre la fracción
 * exacta acumulada de todos los tramos — nunca tramo por tramo, que
 * arrastraría error de redondeo.
 */
import { diasEntre, sumarDiasISO } from "@mafesoftware/fechas-ar";
import { redondearComercial } from "@mafesoftware/plata-ar";

/** Un tramo de tasa vigente desde una fecha (la tasa puede cambiar en el medio del período). */
export type TramoTasa = {
  /** Día de calendario (`YYYY-MM-DD`) desde el que rige `tasaAnual`. */
  desde: string;
  /** Tasa nominal anual en PORCENTAJE, como decimal string (ej. "36" = 36%/año, "10.5" = 10,5%/año). */
  tasaAnual: string;
};

const DECIMALES_TASA = 8;
/** Misma precisión que los factores de `@mafesoftware/plata-ar` (8 decimales) — nunca pasa por `number`. */
const ESCALA_TASA = 10n ** BigInt(DECIMALES_TASA);
const BASE_DIAS = 365n;
const CIEN = 100n;
/** Denominador constante de la fracción de interés: escala de la tasa × 100 (%) × 365 (base de días). */
const DEN_INTERES = ESCALA_TASA * CIEN * BASE_DIAS;

const FORMATO_TASA = /^\d+(\.\d{1,8})?$/;

/**
 * Parsea una tasa anual (string decimal en porcentaje) a un bigint escalado
 * por `ESCALA_TASA`, para operar siempre en enteros exactos.
 */
function tasaEscalada(tasaAnual: string): bigint {
  const texto = tasaAnual.trim();
  if (!FORMATO_TASA.test(texto)) {
    throw new Error(`tasaAnual inválida: "${tasaAnual}" (se espera un decimal positivo de hasta ${DECIMALES_TASA} decimales)`);
  }
  const [entero, decimal = ""] = texto.split(".");
  return BigInt(entero + decimal.padEnd(DECIMALES_TASA, "0"));
}

/** El tramo vigente en `fecha`: el de `desde` más reciente que no la supera (o el más antiguo si ninguno alcanza). */
function tramoVigenteEn(tramos: readonly TramoTasa[], fecha: string): TramoTasa {
  let vigente: TramoTasa | undefined;
  for (const tramo of tramos) {
    if (tramo.desde <= fecha && (vigente === undefined || tramo.desde > vigente.desde)) {
      vigente = tramo;
    }
  }
  if (vigente) return vigente;
  // Ningún tramo empieza en o antes de `fecha`: se asume vigente desde el
  // origen del período (nunca "sin tasa" — sería un cero silencioso).
  return tramos.reduce((mas_antiguo, actual) => (actual.desde < mas_antiguo.desde ? actual : mas_antiguo));
}

/**
 * Interés simple por mora sobre un saldo vencido: `saldo × tasa/365 × días
 * de atraso`, con gracia y tramos de tasa (ver el comentario del módulo).
 *
 * @param saldo Saldo vencido, en centavos.
 * @param desde Fecha de vencimiento (`YYYY-MM-DD`), inicio del período de mora.
 * @param hasta Fecha de corte (`YYYY-MM-DD`) hasta la que se calcula el interés.
 * @param tramos Tasas vigentes, con su fecha de inicio (no puede estar vacío si `saldo > 0`).
 * @param diasGracia Días desde `desde` que no generan interés.
 * @returns El interés acumulado, en centavos (`0n` si `saldo <= 0` o no hay días de atraso).
 */
export function interesMora(
  saldo: bigint,
  desde: string,
  hasta: string,
  tramos: readonly TramoTasa[],
  diasGracia: number
): bigint {
  if (saldo <= 0n || tramos.length === 0) return 0n;

  const inicio = diasGracia > 0 ? sumarDiasISO(desde, diasGracia) : desde;
  if (diasEntre(inicio, hasta) <= 0) return 0n;

  // Puntos de corte del período: inicio, el `desde` de cada tramo que cae
  // ESTRICTAMENTE adentro (un cambio de tasa fuera del rango no lo parte),
  // y hasta. Ordenados y sin duplicados.
  const cortes = new Set<string>([inicio, hasta]);
  for (const tramo of tramos) {
    if (tramo.desde > inicio && tramo.desde < hasta) cortes.add(tramo.desde);
  }
  const puntos = [...cortes].sort();

  let acumulado = 0n; // Σ tasaEscalada(tramo) × días del sub-período
  for (let i = 0; i < puntos.length - 1; i++) {
    const inicioTramo = puntos[i]!;
    const finTramo = puntos[i + 1]!;
    const dias = BigInt(diasEntre(inicioTramo, finTramo));
    const tramo = tramoVigenteEn(tramos, inicioTramo);
    acumulado += tasaEscalada(tramo.tasaAnual) * dias;
  }

  return redondearComercial(saldo * acumulado, DEN_INTERES);
}

/** Bandas de aging (días de atraso), de uso frecuente en listados y resúmenes de mora. */
export type AgingBanda = "0-30" | "31-60" | "61-90" | "90+";

/** Banda de aging correspondiente a `diasAtraso`. */
export function aging(diasAtraso: number): AgingBanda {
  if (diasAtraso <= 30) return "0-30";
  if (diasAtraso <= 60) return "31-60";
  if (diasAtraso <= 90) return "61-90";
  return "90+";
}
