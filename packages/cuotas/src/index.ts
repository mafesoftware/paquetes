/**
 * El motor de la cuota social: vencimientos, recargo por mora e imputación de
 * pagos.
 *
 * Es puro y no toca la base. Recibe deudas y un pago, y devuelve **qué habría
 * que escribir**; la persistencia la pone quien lo llama. Por eso sirve igual
 * para la cuota de un club, la expensa de un consorcio o el abono de un
 * gimnasio.
 *
 * ## Las tres reglas que sostienen todo
 *
 * 1. **Todo en centavos.** Ver `@mafesoftware/plata-ar`. Un peso entero no
 *    aguanta un prorrateo ni un descuento de grupo familiar repartido entre
 *    cinco integrantes.
 * 2. **Un pago se imputa a las deudas MÁS VIEJAS primero.** No es una
 *    preferencia estética: es lo que corta el recargo que se sigue acumulando,
 *    y es lo que espera cualquiera que paga "lo que debo".
 * 3. **La imputación no pierde ni inventa un centavo.** Lo que entra sale:
 *    repartido entre deudas más, si sobra, un saldo a favor explícito. Un
 *    resto que se evapora es una diferencia que aparece meses después en una
 *    conciliación y nadie sabe de dónde salió.
 *
 * ## El recargo se CALCULA, no se guarda
 *
 * Una deuda guarda su importe y su vencimiento; el recargo sale de mirar el
 * calendario en el momento en que se pregunta. Guardarlo lo congela: la cuota
 * de marzo tendría el recargo de abril para siempre, y el socio que llama para
 * saber cuánto debe hoy recibe el número de la última vez que alguien abrió la
 * pantalla.
 *
 * Lo que sí se guarda es **el recargo que se cobró efectivamente**, adentro de
 * la imputación, porque eso ya es un hecho.
 */

import { repartirCentavos, sumarCentavos, aplicarPorcentaje, type Centavos } from "@mafesoftware/plata-ar";
import { diasEntre, sumarDiasISO } from "@mafesoftware/fechas-ar";

export type { Centavos };

/**
 * Una deuda: un renglón que alguien debe.
 *
 * `vencimiento` es un DÍA de calendario (`"2026-09-10"`), no un instante: la
 * cuota vence el 10, no a las 00:00 UTC del 10.
 */
export type Deuda = {
  id: string;
  /** Día de vencimiento, `"AAAA-MM-DD"`. */
  vencimiento: string;
  /** Lo que se debe, sin recargo. */
  importe: Centavos;
  /**
   * El CAPITAL ya imputado a esta deuda. Sin el recargo.
   *
   * (Este comentario decía "recargo incluido" y era falso: quien la arma pasa
   * la columna `pagado`, que guarda solo capital. El recargo cobrado va aparte,
   * abajo — y confundirlos hace que el saldo salga mal.)
   */
  pagado?: Centavos;
  /**
   * El recargo ya cobrado de esta deuda.
   *
   * Hace falta para no cobrarlo dos veces: el recargo del club es un porcentaje
   * PLANO —"10% de la cuota"— y sin este dato un pago parcial lo volvía a
   * disparar sobre el saldo que quedaba.
   */
  recargoCobrado?: Centavos;
  /** Para mostrar y para congelar en el recibo. */
  concepto?: string;
  /** Una deuda anulada o condonada no se cobra ni cuenta para la morosidad. */
  anulada?: boolean;
};

/** El saldo de una deuda, sin recargo. Nunca negativo. */
export function saldo(d: Deuda): Centavos {
  if (d.anulada) return 0;
  return Math.max(0, d.importe - (d.pagado ?? 0));
}

/* ============================================================
   RECARGO POR MORA
   ============================================================ */

/**
 * Cómo recarga este club.
 *
 * Los `escalones` son la forma común en la Argentina: primer vencimiento sin
 * recargo, segundo vencimiento con un porcentaje fijo. `porcentajeDiario` es
 * la otra, que se suma al escalón que corresponda.
 *
 * `tope` existe porque un recargo diario sin techo sobre una deuda de dos años
 * llega a multiplicar la cuota por diez, y ningún club cobra eso — lo que hace
 * es un plan de pago. Sin tope, el número que muestra la pantalla es una
 * fantasía que después hay que explicar por teléfono.
 */
export type EsquemaRecargo = {
  /**
   * Escalones por días de atraso, en cualquier orden. Se aplica el de mayor
   * `diasVencido` que ya se haya cumplido.
   */
  escalones?: readonly { diasVencido: number; porcentaje: number }[];
  /** Porcentaje POR DÍA de atraso, acumulativo simple (no compuesto). */
  porcentajeDiario?: number;
  /** Días de gracia antes de que empiece a correr cualquier recargo. */
  diasDeGracia?: number;
  /** Tope del recargo, como porcentaje del importe. */
  topePorcentaje?: number;
};

/** Sin recargo. El default honesto para un club que todavía no lo configuró. */
export const SIN_RECARGO: EsquemaRecargo = {};

/**
 * Cuántos días de atraso tiene una deuda al día `hoy`.
 *
 * Cero el mismo día del vencimiento: una cuota que vence el 10 y se paga el 10
 * está en término. Es la clase de borde que, corrida por uno, le cobra recargo
 * a todo un club el día 10 de cada mes.
 */
export function diasDeAtraso(d: Deuda, hoy: string): number {
  return Math.max(0, diasEntre(d.vencimiento, hoy));
}

/**
 * El recargo de una deuda al día `hoy`. Cero si está en término o paga.
 *
 * Se calcula sobre el SALDO, no sobre el importe original: quien pagó la mitad
 * no debe seguir devengando recargo sobre la parte que ya entregó.
 */
export function calcularRecargo(d: Deuda, hoy: string, esquema: EsquemaRecargo = SIN_RECARGO): Centavos {
  const base = saldo(d);
  if (base <= 0) return 0;

  const atraso = diasDeAtraso(d, hoy) - (esquema.diasDeGracia ?? 0);
  if (atraso <= 0) return 0;

  let porcentaje = 0;

  const escalones = [...(esquema.escalones ?? [])].sort((a, b) => a.diasVencido - b.diasVencido);
  for (const e of escalones) {
    // Se aplica UNO: el mayor escalon ya cumplido. Sumarlos convertiria un
    // "10% pasado el segundo vencimiento" en 10% + lo del primero.
    if (atraso >= e.diasVencido) porcentaje = e.porcentaje;
  }

  if (esquema.porcentajeDiario) porcentaje += esquema.porcentajeDiario * atraso;

  if (esquema.topePorcentaje !== undefined) {
    porcentaje = Math.min(porcentaje, esquema.topePorcentaje);
  }

  porcentaje = Math.max(0, porcentaje);

  /**
   * El recargo se calcula sobre lo que se DEBE, pero el total cobrado por esta
   * deuda nunca supera el porcentaje de la cuota entera.
   *
   * Las dos mitades hacen falta:
   *
   * - Sobre el saldo, para que a quien pagó parte ANTES de vencer el recargo le
   *   caiga solo sobre lo que pagó tarde.
   * - Con el tope, para que un pago parcial no vuelva a disparar el recargo
   *   completo. Sin él, una cuota de 100000 al 10% terminaba costando 115500 si
   *   se pagaba en dos veces, y componía: cada pago parcial agregaba recargo
   *   sobre el resto. El socio que no puede pagar todo de una es exactamente el
   *   que más lo sufría.
   */
  const sobreElSaldo = aplicarPorcentaje(base, porcentaje);
  const techoDeLaDeuda = aplicarPorcentaje(Math.max(0, d.importe), porcentaje);
  const yaCobrado = Math.max(0, d.recargoCobrado ?? 0);

  return Math.max(0, Math.min(sobreElSaldo, techoDeLaDeuda - yaCobrado));
}

/** Saldo + recargo: lo que hay que pagar hoy por esta deuda. */
export function totalAPagar(d: Deuda, hoy: string, esquema: EsquemaRecargo = SIN_RECARGO): Centavos {
  return saldo(d) + calcularRecargo(d, hoy, esquema);
}

/* ============================================================
   ESTADO DEL SOCIO
   ============================================================ */

export type EstadoSocio = "al_dia" | "moroso";

export type ResumenDeuda = {
  estado: EstadoSocio;
  /** Lo que se debe sin recargo, de todo lo emitido. */
  saldoTotal: Centavos;
  /** Lo que se debe hoy, recargo incluido. */
  totalConRecargo: Centavos;
  /** Solo lo VENCIDO, con su recargo. Es lo que define la morosidad. */
  vencidoConRecargo: Centavos;
  /** Cuántas deudas vencidas hay. */
  periodosVencidos: number;
  /** Los días de atraso de la deuda más vieja sin pagar. 0 si no hay. */
  diasDeAtrasoMaximo: number;
};

/**
 * El estado de cuota de un socio: lo que decide si el molinete abre.
 *
 * `toleranciaDias` es el margen que el club le da a la gente antes de tratarla
 * como morosa. Un club que emite el 1 y vence el 10 normalmente tolera algunos
 * días más: sin tolerancia, el 11 a la mañana media institución no puede
 * entrar a hacer gimnasia, y el teléfono no para.
 *
 * `toleranciaPeriodos` es la otra forma de decir lo mismo, y muchos clubes la
 * prefieren: "se te corta el acceso recién cuando debés dos meses".
 */
export function resumirDeuda(
  deudas: readonly Deuda[],
  hoy: string,
  opciones: {
    esquema?: EsquemaRecargo;
    toleranciaDias?: number;
    toleranciaPeriodos?: number;
  } = {}
): ResumenDeuda {
  const { esquema = SIN_RECARGO, toleranciaDias = 0, toleranciaPeriodos = 0 } = opciones;

  const vivas = deudas.filter((d) => !d.anulada && saldo(d) > 0);
  const vencidas = vivas.filter((d) => diasDeAtraso(d, hoy) > toleranciaDias);

  const saldoTotal = sumarCentavos(vivas.map(saldo));
  const totalConRecargo = sumarCentavos(vivas.map((d) => totalAPagar(d, hoy, esquema)));
  const vencidoConRecargo = sumarCentavos(vencidas.map((d) => totalAPagar(d, hoy, esquema)));
  const diasDeAtrasoMaximo = vivas.reduce((m, d) => Math.max(m, diasDeAtraso(d, hoy)), 0);

  // La tolerancia por periodos se cuenta sobre las VENCIDAS: deber dos cuotas
  // de las cuales una todavia no vencio no es deber dos cuotas.
  const moroso = vencidas.length > toleranciaPeriodos;

  return {
    estado: moroso ? "moroso" : "al_dia",
    saldoTotal,
    totalConRecargo,
    vencidoConRecargo,
    periodosVencidos: vencidas.length,
    diasDeAtrasoMaximo,
  };
}

/* ============================================================
   IMPUTACIÓN DE PAGOS
   ============================================================ */

export type Imputacion = {
  deudaId: string;
  /** Lo que se aplicó al capital de la deuda. */
  aCapital: Centavos;
  /** Lo que se aplicó al recargo. Se guarda porque ya es un hecho. */
  aRecargo: Centavos;
  /** `aCapital + aRecargo`. */
  total: Centavos;
  /** Si esta deuda queda saldada con esta imputación. */
  cancelada: boolean;
};

export type ResultadoImputacion = {
  imputaciones: Imputacion[];
  /** Lo que sobró y queda a favor del socio. */
  aFavor: Centavos;
  /** Lo que se aplicó en total. `aplicado + aFavor === importe`, siempre. */
  aplicado: Centavos;
};

/**
 * Reparte un pago entre las deudas de un socio.
 *
 * ## El orden importa y no es negociable
 *
 * **Las más viejas primero.** Es lo que corta el recargo que sigue corriendo, y
 * es lo que espera quien paga. Pagar la del mes que viene mientras se acumula
 * mora en la de marzo no es una opción razonable: es un bug.
 *
 * ## Dentro de una deuda, primero el RECARGO
 *
 * Si no, una imputación parcial baja el capital y deja el recargo colgando; al
 * día siguiente el recargo se recalcula sobre un capital menor y el número que
 * el socio vio ayer ya no existe. Cobrando primero el recargo, lo pagado queda
 * firme.
 *
 * ## Parciales
 *
 * Por defecto se aceptan: alguien entrega lo que tiene y se le imputa. Con
 * `soloCancelaciones: true` una deuda se imputa entera o no se toca, que es lo
 * que quiere una conciliación de débito automático — un débito parcial no
 * existe, y aceptarlo deja una cuota "medio paga" que ningún proceso vuelve a
 * mirar.
 */
export function imputarPago(
  importe: Centavos,
  deudas: readonly Deuda[],
  opciones: {
    hoy: string;
    esquema?: EsquemaRecargo;
    /** Imputar solo a estas deudas, en este orden. Para el pago de una cuota puntual. */
    soloDeudas?: readonly string[];
    soloCancelaciones?: boolean;
  }
): ResultadoImputacion {
  const { hoy, esquema = SIN_RECARGO, soloCancelaciones = false } = opciones;

  if (!Number.isFinite(importe) || importe <= 0) {
    return { imputaciones: [], aFavor: Math.max(0, Math.trunc(importe) || 0), aplicado: 0 };
  }
  const total = Math.trunc(importe);

  let candidatas = deudas.filter((d) => !d.anulada && saldo(d) > 0);

  if (opciones.soloDeudas) {
    const orden = new Map(opciones.soloDeudas.map((id, i) => [id, i]));
    candidatas = candidatas
      .filter((d) => orden.has(d.id))
      .sort((a, b) => orden.get(a.id)! - orden.get(b.id)!);
  } else {
    // Las mas viejas primero. El id desempata para que dos deudas del mismo dia
    // se imputen siempre en el mismo orden — si no, el mismo pago da dos
    // resultados distintos y la conciliacion no cierra.
    candidatas = [...candidatas].sort(
      (a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.id.localeCompare(b.id)
    );
  }

  const imputaciones: Imputacion[] = [];
  let resto = total;

  for (const d of candidatas) {
    if (resto <= 0) break;

    const capital = saldo(d);
    const recargo = calcularRecargo(d, hoy, esquema);
    const necesario = capital + recargo;

    if (soloCancelaciones && resto < necesario) continue;

    const aplica = Math.min(resto, necesario);
    // Primero el recargo: deja lo pagado firme frente al recalculo de manana.
    const aRecargo = Math.min(aplica, recargo);
    const aCapital = aplica - aRecargo;

    imputaciones.push({
      deudaId: d.id,
      aCapital,
      aRecargo,
      total: aplica,
      cancelada: aplica >= necesario,
    });
    resto -= aplica;
  }

  const aplicado = sumarCentavos(imputaciones.map((i) => i.total));
  // La invariante: lo que entro, sale. Ni un centavo se evapora.
  return { imputaciones, aplicado, aFavor: total - aplicado };
}

/* ============================================================
   EMISIÓN DE UN PERÍODO
   ============================================================ */

export type SocioAEmitir = {
  id: string;
  /** Importe base de su categoría, mensual. */
  importe: Centavos;
  /** Día del mes desde el que es socio, si entró durante el período. */
  altaEnElPeriodo?: string;
  /** Día del mes en que se dio de baja, si se fue durante el período. */
  bajaEnElPeriodo?: string;
  /** Descuentos y adicionales propios, ya resueltos por quien llama. */
  ajustes?: readonly { concepto: string; importe: Centavos }[];
  /** Con quién comparte el descuento de grupo familiar. */
  grupoFamiliarId?: string | null;
};

export type CuotaEmitida = {
  socioId: string;
  importe: Centavos;
  /** El desglose, para que el recibo pueda explicar el número. */
  renglones: { concepto: string; importe: Centavos }[];
};

/**
 * Prorratea un importe mensual por los días que el socio estuvo activo.
 *
 * Un socio que se asocia el 20 de un mes de 30 días paga 11/30 de la cuota
 * —el 20 incluido—, no el mes entero. Cobrar el mes entero al que se asocia a
 * fin de mes es la primera queja de todo club que digitaliza.
 */
export function prorratear(
  importeMensual: Centavos,
  opciones: { desdeISO: string; hastaISO: string; altaISO?: string; bajaISO?: string }
): Centavos {
  const { desdeISO, hastaISO } = opciones;
  const diasDelPeriodo = diasEntre(desdeISO, hastaISO) + 1;
  if (diasDelPeriodo <= 0) return 0;

  const inicio = opciones.altaISO && opciones.altaISO > desdeISO ? opciones.altaISO : desdeISO;
  const fin = opciones.bajaISO && opciones.bajaISO < hastaISO ? opciones.bajaISO : hastaISO;

  const diasActivo = diasEntre(inicio, fin) + 1;
  if (diasActivo <= 0) return 0;
  if (diasActivo >= diasDelPeriodo) return importeMensual;

  // Se reparte el importe entre los dias del periodo y se suman los dias que
  // el socio estuvo activo, en vez de multiplicar y redondear: asi la suma de
  // los prorrateos de todos los tramos de un mes da EXACTAMENTE la cuota.
  //
  // El tramo tiene que ser el SUYO, no "los primeros N dias". `repartirCentavos`
  // deja los centavos sobrantes al principio del arreglo, asi que dos tramos
  // que empiezan en dias distintos y toman los primeros N se llevan los mismos
  // centavos sobrantes y la suma da de mas — lo que se veia como once centavos
  // que aparecian de la nada al partir un mes en dos.
  const porDia = repartirCentavos(importeMensual, Array(diasDelPeriodo).fill(1));
  const desde = diasEntre(desdeISO, inicio);
  return sumarCentavos(porDia.slice(desde, desde + diasActivo));
}

/**
 * Emite las cuotas de un período.
 *
 * `descuentoFamiliar` es el porcentaje que se le hace a los integrantes de un
 * grupo familiar **a partir del segundo** — el titular paga entera. Es como lo
 * cobran los clubes y como lo entiende la gente.
 */
export function emitirPeriodo(
  socios: readonly SocioAEmitir[],
  opciones: {
    desdeISO: string;
    hastaISO: string;
    descuentoFamiliarPorcentaje?: number;
  }
): CuotaEmitida[] {
  const { desdeISO, hastaISO, descuentoFamiliarPorcentaje = 0 } = opciones;

  // Cuantos integrantes activos tiene cada grupo, para saber quien lleva
  // descuento. Se cuenta ANTES de emitir: si se contara mientras se emite, el
  // primero de la lista nunca lo tendria y el ultimo siempre.
  const porGrupo = new Map<string, string[]>();
  for (const s of socios) {
    if (!s.grupoFamiliarId) continue;
    const lista = porGrupo.get(s.grupoFamiliarId) ?? [];
    lista.push(s.id);
    porGrupo.set(s.grupoFamiliarId, lista);
  }

  const emitidas: CuotaEmitida[] = [];

  for (const s of socios) {
    const renglones: { concepto: string; importe: Centavos }[] = [];

    const base = prorratear(s.importe, {
      desdeISO,
      hastaISO,
      altaISO: s.altaEnElPeriodo,
      bajaISO: s.bajaEnElPeriodo,
    });

    // Un socio que no estuvo activo ni un dia del periodo no genera cuota.
    if (base <= 0 && !(s.ajustes ?? []).length) continue;

    renglones.push({ concepto: "Cuota social", importe: base });

    if (descuentoFamiliarPorcentaje > 0 && s.grupoFamiliarId) {
      const grupo = porGrupo.get(s.grupoFamiliarId) ?? [];
      const esPrimero = grupo[0] === s.id;
      if (!esPrimero && grupo.length > 1) {
        renglones.push({
          concepto: `Descuento grupo familiar (${descuentoFamiliarPorcentaje}%)`,
          importe: -aplicarPorcentaje(base, descuentoFamiliarPorcentaje),
        });
      }
    }

    for (const a of s.ajustes ?? []) renglones.push({ concepto: a.concepto, importe: a.importe });

    const importe = sumarCentavos(renglones.map((r) => r.importe));
    // Una cuota no puede quedar negativa: un descuento mas grande que la cuota
    // se convertiria en plata que el club le debe al socio sin que nadie lo
    // haya decidido. Se topea en cero y el excedente se pierde a proposito.
    emitidas.push({ socioId: s.id, importe: Math.max(0, importe), renglones });
  }

  return emitidas;
}

/**
 * Los vencimientos de un período: el primero y, si hay, el segundo.
 *
 * Se devuelven como días de calendario para que el que emite los guarde tal
 * cual los eligió.
 */
export function vencimientosDe(
  primerVencimientoISO: string,
  diasHastaElSegundo?: number
): { primero: string; segundo?: string } {
  if (!diasHastaElSegundo || diasHastaElSegundo <= 0) return { primero: primerVencimientoISO };
  return {
    primero: primerVencimientoISO,
    segundo: sumarDiasISO(primerVencimientoISO, diasHastaElSegundo),
  };
}
