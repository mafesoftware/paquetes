/**
 * Obligaciones que se devengan por período y se cancelan con pagos:
 * sueldos, alquileres, acuerdos de sponsor, cuotas. Núcleo puro — sin
 * base, sin framework, sin reloj (el "hoy" entra siempre por parámetro),
 * plata en centavos `bigint`.
 *
 * Extraído de bocaunidos (`src/lib/dominio/devengados.ts`) con la misma
 * API y semántica: pasar a importarlo de acá es cambiar solo el import.
 */
import {
  esPeriodo,
  periodoDe,
  sumarPeriodos as sumarPeriodosFechas,
  type Periodo as PeriodoFechas,
} from "@mafesoftware/fechas-ar";

/**
 * Un período "YYYY-MM". Se tipa como `string` (no el template literal de
 * fechas-ar) para que lo que viene de la base se pueda pasar sin casts; las
 * funciones que lo necesitan válido lo validan.
 */
export type Periodo = string;

/** Tira un error claro si `p` no es un período "YYYY-MM" válido (mes 01..12). */
function validarPeriodo(p: unknown, campo: string): PeriodoFechas {
  if (typeof p !== "string" || !esPeriodo(p)) {
    throw new Error(`${campo}: período inválido "${String(p)}" (se espera "YYYY-MM", mes 01..12).`);
  }
  return p;
}

/** `periodoDe` de fechas-ar, pero con el nombre del campo en el mensaje de error. */
function periodoDeCampo(fecha: unknown, campo: string): PeriodoFechas {
  try {
    return periodoDe(fecha as string);
  } catch {
    throw new Error(`${campo}: fecha inválida "${String(fecha)}" (se espera "YYYY-MM-DD", un día real).`);
  }
}

function siguientePeriodo(p: PeriodoFechas): PeriodoFechas {
  return sumarPeriodosFechas(p, 1);
}

/** Cómo está una obligación según lo devengado y lo pagado. */
export type EstadoSaldo = "sin_deuda" | "pendiente" | "parcial" | "saldada" | "pagado_de_mas";

/**
 * - `sin_deuda`: no se devengó nada (0) y tampoco se pagó.
 * - `pendiente`: hay devengado y no se pagó nada.
 * - `parcial`: se pagó una parte.
 * - `saldada`: pagado == devengado.
 * - `pagado_de_mas`: se pagó más de lo devengado (anticipo o error de carga — conviene mirarlo).
 *
 * Total: todo par de `bigint` cae en exactamente uno de los cinco estados.
 */
export function estadoSaldo(devengado: bigint, pagado: bigint): EstadoSaldo {
  if (typeof devengado !== "bigint" || typeof pagado !== "bigint") {
    throw new Error("estadoSaldo: devengado y pagado tienen que ser bigint (centavos).");
  }
  if (devengado <= 0n && pagado <= 0n) return "sin_deuda";
  if (pagado <= 0n) return "pendiente";
  if (pagado < devengado) return "parcial";
  if (pagado === devengado) return "saldada";
  return "pagado_de_mas";
}

/** El período ("YYYY-MM") de una fecha "YYYY-MM-DD". Tira si la fecha no es válida. */
export function periodoDeFecha(fecha: string): Periodo {
  return periodoDeCampo(fecha, "periodoDeFecha");
}

/** "2026-06" → "2026-06-01" (así se guarda el período en la base: primer día del mes). */
export function primerDia(periodo: Periodo): string {
  return `${validarPeriodo(periodo, "primerDia")}-01`;
}

/**
 * Los períodos de `desde` a `hasta`, ambos incluidos, en orden. Vacío si
 * `desde > hasta`. Tira si alguno de los dos no es un período válido.
 */
export function periodosEntre(desde: Periodo, hasta: Periodo): Periodo[] {
  const inicio = validarPeriodo(desde, "periodosEntre (desde)");
  const fin = validarPeriodo(hasta, "periodosEntre (hasta)");
  const salida: Periodo[] = [];
  for (let p = inicio; p <= fin; p = siguientePeriodo(p)) salida.push(p);
  return salida;
}

/** Un valor mensual vigente desde un período (el alquiler sube, el sueldo se actualiza). */
export type Vigencia = { desde: Periodo; monto: bigint };

function validarVigencias(vigencias: readonly Vigencia[], campo: string): void {
  if (!Array.isArray(vigencias)) throw new Error(`${campo}: vigencias tiene que ser un array.`);
  vigencias.forEach((v: Vigencia | undefined, i) => {
    validarPeriodo(v?.desde, `${campo} (vigencias[${i}].desde)`);
    if (typeof v?.monto !== "bigint") {
      throw new Error(`${campo} (vigencias[${i}].monto): tiene que ser bigint (centavos).`);
    }
  });
}

/**
 * El monto vigente en `periodo`: la vigencia más reciente con
 * `desde <= periodo`, o `null` si ninguna rige todavía. El orden de la lista
 * no importa; con dos vigencias del mismo `desde` gana la primera.
 */
export function montoVigente(vigencias: readonly Vigencia[], periodo: Periodo): bigint | null {
  validarPeriodo(periodo, "montoVigente");
  validarVigencias(vigencias, "montoVigente");
  let elegido: Vigencia | null = null;
  for (const v of vigencias) {
    if (v.desde <= periodo && (elegido === null || v.desde > elegido.desde)) elegido = v;
  }
  return elegido?.monto ?? null;
}

export type ContratoMensual = {
  /** Fecha de inicio "YYYY-MM-DD": devenga desde el mes de esta fecha. */
  inicio: string;
  /** Fecha de baja "YYYY-MM-DD" o null: devenga hasta el mes de esta fecha, incluido. */
  baja: string | null;
  /** Día del mes en que vence cada cuota (1-28). Un mes cuenta como vencido cuando ya pasó ese día. */
  diaVencimiento: number;
  vigencias: readonly Vigencia[];
  /**
   * Corte de migración "YYYY-MM-DD" o null. Si hay corte, los meses hasta el
   * del corte inclusive ya están contados en `devengadoPrevio` y no se
   * recalculan.
   */
  corte?: string | null;
  devengadoPrevio?: bigint;
};

export type CuotaDevengada = { periodo: Periodo; monto: bigint; vence: string };

/**
 * Las cuotas YA VENCIDAS al día `hasta` ("YYYY-MM-DD"), una por mes, con el
 * monto vigente de cada mes. Un mes sin vigencia que lo cubra no devenga
 * (0 cuotas, no 0 pesos inventados). `diaVencimiento` se trunca y se acota a
 * 1..28 (así febrero siempre tiene ese día).
 */
export function cuotasVencidas(contrato: ContratoMensual, hasta: string): CuotaDevengada[] {
  if (typeof contrato.diaVencimiento !== "number" || !Number.isFinite(contrato.diaVencimiento)) {
    throw new Error(
      `cuotasVencidas: diaVencimiento inválido "${String(contrato.diaVencimiento)}" (se espera un número 1..28).`,
    );
  }
  if (contrato.devengadoPrevio !== undefined && typeof contrato.devengadoPrevio !== "bigint") {
    throw new Error("cuotasVencidas: devengadoPrevio tiene que ser bigint (centavos).");
  }
  validarVigencias(contrato.vigencias, "cuotasVencidas");
  const dia = Math.min(Math.max(Math.trunc(contrato.diaVencimiento), 1), 28);
  const mesHasta = periodoDeCampo(hasta, "cuotasVencidas (hasta)");

  let desde = periodoDeCampo(contrato.inicio, "cuotasVencidas (inicio)");
  if (contrato.corte) {
    const despuesDelCorte = siguientePeriodo(periodoDeCampo(contrato.corte, "cuotasVencidas (corte)"));
    if (despuesDelCorte > desde) desde = despuesDelCorte;
  }
  let ultimo = mesHasta;
  if (contrato.baja) {
    const mesBaja = periodoDeCampo(contrato.baja, "cuotasVencidas (baja)");
    if (mesBaja < ultimo) ultimo = mesBaja;
  }

  const cuotas: CuotaDevengada[] = [];
  for (const periodo of periodosEntre(desde, ultimo)) {
    const vence = `${periodo}-${String(dia).padStart(2, "0")}`;
    if (vence > hasta) continue;
    const monto = montoVigente(contrato.vigencias, periodo);
    if (monto === null) continue;
    cuotas.push({ periodo, monto, vence });
  }
  return cuotas;
}

/** Total devengado y vencido al día `hasta`: lo previo al corte + las cuotas vencidas desde entonces. */
export function devengadoAl(contrato: ContratoMensual, hasta: string): bigint {
  return cuotasVencidas(contrato, hasta).reduce((acc, c) => acc + c.monto, contrato.devengadoPrevio ?? 0n);
}

/**
 * Suma valores por (fila, período) — la tabla dinámica que el Excel arma
 * con un SUMIFS por celda. Devuelve los totales por celda, por fila, por
 * período y el general. Las claves que no aparecen no se inventan (el
 * consumidor decide si muestra 0 o "—").
 */
export type Matriz = {
  celdas: Map<string, Map<Periodo, bigint>>;
  porFila: Map<string, bigint>;
  porPeriodo: Map<Periodo, bigint>;
  total: bigint;
};

/**
 * Arma la `Matriz` de una lista de importes. `fila` y `periodo` se usan como
 * claves tal cual (no se valida que `periodo` sea "YYYY-MM": sirve igual para
 * agrupar por otra cosa). Tira si un `importe` no es `bigint`.
 */
export function matrizPorPeriodo(filas: Iterable<{ fila: string; periodo: Periodo; importe: bigint }>): Matriz {
  const celdas = new Map<string, Map<Periodo, bigint>>();
  const porFila = new Map<string, bigint>();
  const porPeriodo = new Map<Periodo, bigint>();
  let total = 0n;
  for (const { fila, periodo, importe } of filas) {
    if (typeof importe !== "bigint") {
      throw new Error(
        `matrizPorPeriodo: el importe de (${String(fila)}, ${String(periodo)}) tiene que ser bigint (centavos).`,
      );
    }
    let fil = celdas.get(fila);
    if (!fil) {
      fil = new Map();
      celdas.set(fila, fil);
    }
    fil.set(periodo, (fil.get(periodo) ?? 0n) + importe);
    porFila.set(fila, (porFila.get(fila) ?? 0n) + importe);
    porPeriodo.set(periodo, (porPeriodo.get(periodo) ?? 0n) + importe);
    total += importe;
  }
  return { celdas, porFila, porPeriodo, total };
}
