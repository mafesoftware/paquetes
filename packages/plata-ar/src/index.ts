/**
 * La plata, en centavos.
 *
 * Toda columna de plata guarda CENTAVOS. Este paquete es el único lugar donde
 * un monto se convierte de o hacia pesos: al formatear para una pantalla, al
 * parsear lo que alguien tipeó, y en los bordes con sistemas que hablan en
 * pesos (Mercado Pago, el CSV que abre una planilla).
 *
 * ## Por qué centavos
 *
 * Un entero de pesos alcanza para cobrar una cuota y cerrar la caja. Deja de
 * alcanzar en dos lugares concretos:
 *
 * 1. **Repartir un monto entre partes.** El 21% de $1.234 es $259,14. Si se
 *    redondea por renglón, la suma de los renglones no da el total, y ese
 *    descuadre es el que rechaza un organismo fiscal — semanas después, con un
 *    código que no dice eso.
 * 2. **Prorratear.** Una cuota que arranca a mitad de mes, un descuento de
 *    grupo familiar repartido entre cinco integrantes: redondear en cada paso
 *    corre el total lo suficiente como para que la liquidación no cierre.
 *
 * El paquete no tiene dependencias y no lee variables de entorno.
 *
 * ## 0.2: `bigint` y multimoneda
 *
 * La API de abajo (`Centavos = number`) se mantiene íntegra — gestionflow la
 * sigue usando— pero queda `@deprecated`: un monto en `number` dejó de
 * alcanzar en dos lugares que si pasan en este país: factores de ajuste con
 * 8 decimales que no entran exactos en un float, y montos que necesitan
 * moneda propia (USD, EUR) para no mezclarse por error. La API nueva
 * (`Importe`, `aplicarFactor`, `repartirPorMayorResto`, `convertir`,
 * `sumar`, `parsearImporte`) vive en `bigint.ts`, `factor.ts`, `reparto.ts`,
 * `moneda.ts` y `parseo.ts`, re-exportada acá.
 */

export * from "./errores.js";
export * from "./bigint.js";
export * from "./factor.js";
export * from "./reparto.js";
export * from "./moneda.js";
export * from "./parseo.js";

import type { Importe, Moneda } from "./moneda.js";

/**
 * Un monto guardado en centavos, como `number`.
 *
 * @deprecated Un `number` no alcanza para los factores de 8 decimales ni
 * para montos con moneda propia. Usar `Importe` (`{ centavos: bigint;
 * moneda: Moneda }`) de `moneda.ts`.
 */
export type Centavos = number;

/**
 * El techo de un monto: `MAX_SAFE_INTEGER` centavos.
 *
 * No es una decisión de producto, es el límite de los enteros de JavaScript.
 * Pasado ese punto los enteros dejan de ser exactos —saltan de dos en dos, y
 * después de mil en mil—, así que un monto más grande **no es un monto**: es un
 * número que nadie tipeó y que Postgres o rechaza o guarda mal.
 *
 * Son unos noventa billones de pesos. Ninguna cuota de ningún club se acerca.
 */
export const MAXIMO_CENTAVOS = Number.MAX_SAFE_INTEGER;

/**
 * Pesos a centavos. `null` si el monto no se puede representar exacto.
 *
 * Devuelve `null` y no `0`: un cero silencioso es un pago de cero pesos
 * registrado como si fuera lo que la persona quiso escribir.
 */
export function aCentavos(pesos: number): Centavos | null {
  if (!Number.isFinite(pesos)) return null;
  if (Math.abs(pesos) > MAXIMO_CENTAVOS / 100) return null;
  // `Math.round` sobre el producto y no `parseInt`: 19.99 * 100 da
  // 1998.9999999999998 en coma flotante, y truncar deja 1998.
  const centavos = Math.round(pesos * 100);
  // Con el guard de arriba (`Math.abs(pesos) <= MAXIMO_CENTAVOS / 100`) esto
  // nunca da `false`: verificado exhaustivamente contra los flotantes
  // vecinos del límite, en los dos signos. Queda como salvaguarda
  // defensiva, no como camino alcanzable.
  /* v8 ignore next */
  if (!Number.isSafeInteger(centavos)) return null;
  return centavos;
}

export function aPesos(centavos: Centavos): number {
  return centavos / 100;
}

/** Opciones de formato. Los defaults son los de la Argentina. */
export type FormatoPlata = {
  /** Código ISO de la moneda. `"ARS"` por defecto. */
  moneda?: string;
  /** Locale para separadores y símbolo. `"es-AR"` por defecto. */
  locale?: string;
  /**
   * Mostrar siempre los dos decimales. Por defecto `false`: un monto redondo
   * sale sin decimales, que es como se lee la plata en el país.
   */
  decimalesSiempre?: boolean;
};

/** Opciones de formato para un `Importe`/`bigint` (API 0.2). */
export type FormatoImporte = {
  /** Moneda a usar cuando `i` es un `bigint` a secas. Ignorada si `i` es un `Importe` (se usa `i.moneda`). `"ARS"` por defecto. */
  moneda?: Moneda;
  /** Locale para separadores y símbolo. `"es-AR"` por defecto. */
  locale?: string;
  /** Mostrar siempre los dos decimales. `true` por defecto: a diferencia de la 0.1, acá un monto multimoneda siempre lleva sus decimales. */
  decimalesSiempre?: boolean;
};

/**
 * Un monto para mostrar, en centavos, como `number`.
 *
 * Sin decimales cuando el monto es redondo —que en este país es casi
 * siempre— y con dos cuando no. Mostrar "$ 44.000,00" en una lista de cuotas
 * es ruido; esconder los 14 centavos de un prorrateo es un error.
 *
 * @deprecated Usar `formatearPlata(importe: Importe | bigint, opciones?)`.
 * @example
 * formatearPlata(4_400_000); // "$ 44.000"
 */
export function formatearPlata(centavos: Centavos, opciones?: FormatoPlata): string;
/**
 * Un `Importe` (o un monto en centavos `bigint`, sin moneda propia) para
 * mostrar. A diferencia de la variante `Centavos` de la 0.1, siempre muestra
 * los dos decimales por defecto: en un panel multimoneda "US$ 50" sin
 * decimales es ambiguo con un monto ARS.
 *
 * @example
 * formatearPlata({ centavos: -5_000n, moneda: "USD" }); // "-US$ 50,00"
 * @example
 * formatearPlata(4_400_000n); // "$ 44.000,00" (bigint a secas: moneda ARS por defecto)
 */
export function formatearPlata(importe: Importe | bigint, opciones?: FormatoImporte): string;
export function formatearPlata(
  i: Centavos | Importe | bigint,
  opciones: { moneda?: string; locale?: string; decimalesSiempre?: boolean } = {},
): string {
  if (typeof i === "number") {
    const { moneda = "ARS", locale = "es-AR", decimalesSiempre = false } = opciones;
    const decimales = decimalesSiempre || i % 100 !== 0 ? 2 : 0;
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: moneda,
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(aPesos(i));
  }

  const esBigintASecas = typeof i === "bigint";
  const centavosBig = esBigintASecas ? i : i.centavos;
  const monedaResuelta: Moneda = (opciones.moneda as Moneda | undefined) ?? (esBigintASecas ? "ARS" : i.moneda);
  const { locale = "es-AR", decimalesSiempre = true } = opciones;
  const decimales = decimalesSiempre || centavosBig % 100n !== 0n ? 2 : 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: monedaResuelta,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(Number(centavosBig) / 100);
}

/** Atajo para el caso argentino, que es el 99% de las llamadas. */
export function plataARS(centavos: Centavos): string {
  return formatearPlata(centavos);
}

/**
 * Lo que alguien tipeó, en centavos. `null` si no es un número.
 *
 * Tiene que entender las dos formas en que llega la plata acá y son
 * incompatibles entre sí:
 *
 * - `1.234,56` — como se escribe en el país: miles con punto, decimales con
 *   coma. También `$ 44.000`, que es cuarenta y cuatro mil.
 * - `1234.56` — como sale de copiar una celda de una planilla en inglés.
 *
 * Dos reglas, en este orden:
 *
 * 1. **Si hay coma, la coma es el decimal** y los puntos son miles.
 * 2. Sin coma, **un punto seguido de exactamente tres dígitos es separador de
 *    miles**; con uno o dos dígitos es un decimal. Es lo que distingue
 *    `44.000` (cuarenta y cuatro mil) de `1234.56` (mil doscientos treinta y
 *    cuatro con cincuenta y seis).
 *
 * Queda ambiguo escribir `1.500` queriendo decir un peso con cincuenta, y se
 * resuelve como mil quinientos a propósito: en un panel de cuotas argentinas
 * el primero pasa todos los días y el segundo no pasa nunca.
 *
 * **OJO: devuelve CENTAVOS. Solo para PLATA.** Un porcentaje, una cantidad o
 * un día que pasen por acá salen multiplicados por cien. Para un porcentaje
 * está `parsearPorcentaje`; para una cantidad, `parsearCantidad`.
 *
 * @deprecated Usar `parsearImporte` (de `parseo.ts`): devuelve `bigint` y,
 * en vez de `null`, un `{ ok: false, error }` legible. Se llama distinto
 * (no `parsearPlata`) porque la forma del resultado cambió de raíz.
 */
export function parsearPlata(texto: string): Centavos | null {
  const n = parsearNumeroAR(texto);
  return n === null ? null : aCentavos(n);
}

/**
 * Un número escrito a la argentina, como número. NO multiplica por cien.
 *
 * Es la base de `parsearPlata`, y la salida correcta para todo lo que no es
 * plata.
 */
export function parsearNumeroAR(texto: string): number | null {
  const limpio = String(texto ?? "").replace(/[^\d.,-]/g, "").trim();
  if (!limpio) return null;

  let normalizado: string;
  if (limpio.includes(",")) {
    normalizado = limpio.replace(/\./g, "").replace(",", ".");
  } else {
    const miles = /\.\d{3}(?:\D|$)/.test(limpio) || /^\d+(\.\d{3})+$/.test(limpio);
    normalizado = miles ? limpio.replace(/\./g, "") : limpio;
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Un porcentaje tipeado. `10` es diez por ciento, no mil.
 *
 * Existe porque el `parsearPlata` del renglón de al lado se copia sin pensar:
 * un "10" llegó a una acción como 1000 y subió un 1000% a cien registros.
 */
export function parsearPorcentaje(texto: string): number | null {
  return parsearNumeroAR(texto);
}

/** Una cantidad tipeada (cupos, integrantes, socios). No es plata. */
export function parsearCantidad(texto: string): number | null {
  return parsearNumeroAR(texto);
}

/**
 * Un monto para una PLANILLA: pesos, como número sumable.
 *
 * Ni símbolo ni puntos de miles —un monto formateado deja de ser un número
 * para Excel y no se puede sumar, que es exactamente para lo que se baja el
 * archivo—. Entero cuando es redondo; con los centavos y coma decimal cuando
 * no, que es lo que una planilla en español lee como número.
 */
export function pesosParaPlanilla(centavos: Centavos): number | string {
  if (centavos % 100 === 0) return centavos / 100;
  return (centavos / 100).toFixed(2).replace(".", ",");
}

/**
 * Reparte un monto en partes proporcionales **sin perder ni inventar un
 * centavo**.
 *
 * Es la cuenta que hace falta para prorratear una cuota entre los integrantes
 * de un grupo familiar, para partir un descuento entre varios conceptos y para
 * discriminar impuestos por renglón: redondear cada parte por separado deja
 * una suma que no da el total. Acá se redondea para abajo y los centavos que
 * sobran se reparten de a uno, empezando por la parte más grande — que es
 * donde menos se nota.
 *
 * @param total Lo que hay que repartir.
 * @param pesos Cuánto pesa cada parte. Se usan como proporción, no como monto.
 *
 * @deprecated Usar `repartirPorMayorResto` (de `reparto.ts`): trabaja en
 * `bigint`, acepta pesos como `bigint | number | string` sin límite de
 * decimales, y tira `ErrorPlata` en vez de repartir en partes iguales cuando
 * los pesos no sirven (acá, cuando `suma <= 0`).
 */
export function repartirCentavos(total: Centavos, pesos: number[]): Centavos[] {
  if (pesos.length === 0) return [];
  const suma = pesos.reduce((n, p) => n + p, 0);

  // Sin proporciones que valgan, se reparte en partes iguales.
  if (suma <= 0) {
    const base = Math.floor(total / pesos.length);
    const partes = pesos.map(() => base);
    let resto = total - base * pesos.length;
    for (let i = 0; resto > 0; i = (i + 1) % partes.length, resto--) partes[i] = partes[i]! + 1;
    return partes;
  }

  const partes = pesos.map((p) => Math.floor((total * p) / suma));
  let resto = total - partes.reduce((n, p) => n + p, 0);

  // Los centavos sueltos van a las partes más grandes, de a uno.
  const orden = pesos
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p - a.p || a.i - b.i);
  for (let k = 0; resto > 0; k = (k + 1) % orden.length, resto--) {
    const idx = orden[k]!.i;
    partes[idx] = partes[idx]! + 1;
  }
  return partes;
}

/**
 * Aplica un porcentaje a un monto, redondeando a centavo.
 *
 * `porcentaje` es humano: `10` es diez por ciento.
 */
export function aplicarPorcentaje(centavos: Centavos, porcentaje: number): Centavos {
  if (!Number.isFinite(porcentaje)) return 0;
  return Math.round((centavos * porcentaje) / 100);
}

/**
 * Suma una lista de montos. Existe para no repetir el `reduce` con el cero.
 *
 * @deprecated Usar `sumar(...importes: Importe[])` (de `moneda.ts`): además
 * tira si se mezclan monedas distintas, que acá no puede detectarse porque
 * `Centavos` no lleva moneda.
 */
export function sumarCentavos(montos: readonly Centavos[]): Centavos {
  return montos.reduce((n: Centavos, m) => n + m, 0);
}
