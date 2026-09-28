import { redondearComercial } from "@mafesoftware/plata-ar";
import { calcularAjuste } from "./ajuste.js";
import { analizarDecimal } from "./decimal.js";
import { ErrorIndices } from "./errores.js";

/** Entrada de `ajusteConTope`. */
export interface OpcionesAjusteConTope {
  /** El monto sobre el que se calcula el ajuste (y el % del tope). */
  montoBase: bigint;
  /** El valor de índice del período BASE del contrato. */
  valorBase: string;
  /** El valor de índice contra el que se ajusta (el usado al liquidar, o el definitivo). */
  valorRef: string;
  /** El tope del contrato, decimal humano (`"15"` es 15% de `montoBase`). */
  topePct: string;
  /** `true`: el ajuste nunca puede quedar por debajo de 0 (spec: "solo ajusta hacia arriba" es una opción del contrato, no el default). */
  soloPositivo?: boolean;
}

/** Lo que devuelve `ajusteConTope`. */
export interface ResultadoAjusteConTope {
  /** `valorRef / valorBase`, 8 decimales (el mismo que devuelve `calcularAjuste`). */
  factor: string;
  /** El ajuste completo, SIN tope (`calcularAjuste(...).ajuste`). */
  ajusteSinTope: bigint;
  /** El ajuste que efectivamente corresponde aplicar, ya con el tope (y el piso de `soloPositivo`, si aplica). */
  ajusteAplicado: bigint;
  /**
   * `ajusteSinTope - ajusteAplicado`: lo que el tope (o el piso de
   * `soloPositivo`) le sacó al ajuste completo.
   *
   * **Positivo** cuando el ajuste completo superó el tope de arriba (el
   * exceso "absorbido por la desarrolladora", spec 02 §3.2): `ajusteAplicado
   * < ajusteSinTope`.
   *
   * **Negativo** cuando `soloPositivo` capó una deflación a 0 (`ajusteAplicado
   * > ajusteSinTope`, porque `ajusteSinTope` era negativo): ahí lo que no se
   * acredita es del lado del cliente, no de la desarrolladora — distinto
   * fenómeno de negocio que comparte el mismo campo porque nunca pasan a la
   * vez (el tope de arriba y el piso de `soloPositivo` no se activan juntos:
   * uno exige `ajusteSinTope > tope > 0`, el otro `ajusteSinTope < 0`).
   */
  absorbido: bigint;
}

/**
 * El ajuste de una cuota por índice, YA con el tope del contrato aplicado
 * (spec 02 §3.2, ruling del controlador, opción b): el tope limita el ajuste
 * TOTAL de una cuota, no un acumulado independiente por período — por eso
 * capa `ajusteSinTope` (la salida completa de `calcularAjuste`) directo a
 * `[soloPositivo ? 0 : -∞, round(montoBase × topePct / 100)]`, en vez de
 * llevar un acumulado aparte.
 *
 * Esto reemplaza al viejo `aplicarTope` (spec 02 §3.2, versión anterior):
 * ese tomaba un `ajusteAcumuladoPct` + un `ajusteNuevo` sueltos y dejaba
 * pasar CUALQUIER corrección negativa entera, sin mirar contra qué venía
 * capada la cuota anterior. Eso generaba créditos que el cliente no debía
 * recibir: con un provisorio capado al 15% (índice +20%) y un definitivo
 * publicado al +18% (todavía por encima del 15%), la diferencia SIN tope da
 * -2% (`diferenciaDeAjuste`), y el viejo `aplicarTope` la dejaba pasar
 * entera como un crédito de 2 puntos — cuando la cuota nunca había cobrado
 * más del 15% real, así que no hay nada que devolver. Con `ajusteConTope`,
 * los dos valores (usado y definitivo) se capan de manera independiente
 * ANTES de restar (ver `diferenciaDeAjusteConTope`), así que ese caso da 0.
 *
 * El % del tope se calcula exacto en `bigint` (`pct` nunca pasa por
 * `number`) y se redondea comercial al centavo con `redondearComercial` de
 * `plata-ar` — mismo redondeo que `aplicarFactor`.
 *
 * Tira `ErrorIndices("valor_invalido")` si `montoBase < 0`, si `topePct < 0`,
 * o si `topePct` no tiene forma de decimal válido (delegado en
 * `analizarDecimal`) — un tope negativo o un monto base negativo no tienen
 * sentido de negocio, y dejarlos pasar produciría un límite que no limita.
 *
 * @example
 * // Tope 15% sobre $100.000 (10_000_000 centavos), índice +20%:
 * ajusteConTope({ montoBase: 10_000_000n, valorBase: "100", valorRef: "120", topePct: "15" });
 * // ajusteSinTope: 2_000_000n (el +20% completo)
 * // ajusteAplicado: 1_500_000n (capado al 15% de 10_000_000)
 * // absorbido: 500_000n
 * @example
 * // Deflación con soloPositivo: nunca un crédito.
 * ajusteConTope({ montoBase: 10_000_000n, valorBase: "100", valorRef: "90", topePct: "15", soloPositivo: true });
 * // { ajusteSinTope: -1_000_000n, ajusteAplicado: 0n, absorbido: -1_000_000n }
 */
export function ajusteConTope(opciones: OpcionesAjusteConTope): ResultadoAjusteConTope {
  const { montoBase, valorBase, valorRef, topePct, soloPositivo = false } = opciones;

  if (montoBase < 0n) {
    throw new ErrorIndices("valor_invalido", `ajusteConTope: montoBase (${montoBase}) no puede ser negativo.`);
  }

  const { factor, ajuste: ajusteSinTope } = calcularAjuste(montoBase, valorBase, valorRef);
  const limite = pctDeMonto(topePct, montoBase, "ajusteConTope: topePct");

  let ajusteAplicado = ajusteSinTope;
  if (ajusteAplicado > limite) ajusteAplicado = limite;
  if (soloPositivo && ajusteAplicado < 0n) ajusteAplicado = 0n;

  return { factor, ajusteSinTope, ajusteAplicado, absorbido: ajusteSinTope - ajusteAplicado };
}

/** `pct`% de `montoBase`, redondeado comercial al centavo. Exacto en `bigint`: `pct` nunca pasa por `number`. */
function pctDeMonto(pct: string, montoBase: bigint, contexto: string): bigint {
  const d = analizarDecimal(pct, contexto);
  if (d.negativo) {
    throw new ErrorIndices("valor_invalido", `${contexto}: "${pct}" no puede ser negativo.`);
  }
  // `d.negativo` ya está descartado arriba: acá siempre es `montoBase × pct`, sin signo que resolver.
  const numerador = montoBase * d.valorAbs;
  const denominador = 10n ** BigInt(d.escala + 2); // +2: "%" es /100.
  return redondearComercial(numerador, denominador);
}

/** Entrada de `diferenciaDeAjusteConTope`. */
export interface OpcionesDiferenciaDeAjusteConTope {
  montoBase: bigint;
  valorBase: string;
  /** El valor USADO al liquidar la cuota (el último publicado en ese momento). */
  valorUsado: string;
  /** El valor DEFINITIVO, publicado después. */
  valorDefinitivo: string;
  topePct: string;
  soloPositivo?: boolean;
}

/**
 * La diferencia de ajuste entre el valor USADO y el DEFINITIVO, CON el tope
 * del contrato ya aplicado a cada uno por separado (spec 02 §3.2, ruling del
 * controlador, opción b) — `ajusteConTope(definitivo).ajusteAplicado -
 * ajusteConTope(usado).ajusteAplicado`.
 *
 * **Usar esta función (no `diferenciaDeAjuste`) siempre que el contrato
 * tenga un tope** (`topePct`) o la opción `soloPositivo`: al calcular cada
 * lado ya capado antes de restar, una corrección que sigue por encima (o
 * por debajo) del tope en ambos momentos da 0 — no un crédito o cargo
 * fantasma que el tope ya había evitado. `diferenciaDeAjuste` sigue
 * existiendo para el caso SIN tope (spec 02 §3.2, modalidades
 * provisorio/definitivo puras): ahí la resta directa de los montos
 * ajustados es exactamente lo que corresponde, porque no hay nada capado
 * de por medio.
 *
 * Valida `montoBase`/`topePct` igual que `ajusteConTope` (tira
 * `ErrorIndices("valor_invalido")` si `montoBase < 0`, `topePct < 0`, o
 * `topePct` no es un decimal válido) — delega en esa función para cada
 * lado, así que la validación es una sola.
 *
 * @example
 * // Provisorio capado al 15% (índice +20%) y definitivo publicado en +18%
 * // (todavía por encima del 15%): la cuota nunca cobró más del tope real,
 * // así que no hay nada que ajustar.
 * diferenciaDeAjusteConTope({
 *   montoBase: 10_000_000n, valorBase: "100",
 *   valorUsado: "120", valorDefinitivo: "118", topePct: "15",
 * }); // 0n
 */
export function diferenciaDeAjusteConTope(opciones: OpcionesDiferenciaDeAjusteConTope): bigint {
  const { montoBase, valorBase, valorUsado, valorDefinitivo, topePct, soloPositivo } = opciones;
  const conUsado = ajusteConTope({ montoBase, valorBase, valorRef: valorUsado, topePct, soloPositivo });
  const conDefinitivo = ajusteConTope({ montoBase, valorBase, valorRef: valorDefinitivo, topePct, soloPositivo });
  return conDefinitivo.ajusteAplicado - conUsado.ajusteAplicado;
}
