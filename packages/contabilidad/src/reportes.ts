/**
 * Reportes contables — núcleo PURO. Recibe totales ya agregados
 * (`debe`/`haber` por cuenta o por libro) y hace la aritmética; armar esos
 * totales desde los asientos/líneas reales del consumidor (con su propia
 * base) es responsabilidad suya.
 *
 * Convención de signo (RT contable estándar): activo y resultado_negativo
 * (gastos) son de saldo DEUDOR (`debe - haber`); pasivo, PN y
 * resultado_positivo (ingresos) son de saldo ACREEDOR (`haber - debe`).
 */
import { repartirPorMayorResto } from "@mafesoftware/plata-ar";
import type { RubroNaturaleza } from "./plan-cuentas.js";

export type SumaCuenta = { cuentaId: string; codigo: string; naturaleza: RubroNaturaleza; debe: bigint; haber: bigint };

/** Saldo de una cuenta según su naturaleza (positivo = del lado "normal" de esa naturaleza). */
export function saldoDeCuenta(naturaleza: RubroNaturaleza, debe: bigint, haber: bigint): bigint {
  return naturaleza === "activo" || naturaleza === "resultado_negativo" ? debe - haber : haber - debe;
}

export type TotalesSumasYSaldos = { debe: bigint; haber: bigint };

/** Σ debe y Σ haber de una lista de sumas por cuenta — deben coincidir (partida doble). */
export function totalesSumasYSaldos(filas: readonly { debe: bigint; haber: bigint }[]): TotalesSumasYSaldos {
  return filas.reduce((acc, f) => ({ debe: acc.debe + f.debe, haber: acc.haber + f.haber }), { debe: 0n, haber: 0n });
}

/** Agrupa saldos por naturaleza (para un balance general): activo / pasivo / pn / resultado (positivo - negativo, con signo). */
export function agruparPorNaturaleza(filas: readonly SumaCuenta[]): { activo: bigint; pasivo: bigint; pn: bigint; resultado: bigint } {
  const acc = { activo: 0n, pasivo: 0n, pn: 0n, resultado: 0n };
  for (const f of filas) {
    const saldo = saldoDeCuenta(f.naturaleza, f.debe, f.haber);
    if (f.naturaleza === "activo") acc.activo += saldo;
    else if (f.naturaleza === "pasivo") acc.pasivo += saldo;
    else if (f.naturaleza === "pn") acc.pn += saldo;
    else if (f.naturaleza === "resultado_positivo") acc.resultado += saldo;
    else acc.resultado -= saldo; // resultado_negativo: saldo ya es "gasto positivo" (deudor) → resta del resultado
  }
  return acc;
}

/** `true` si Activo = Pasivo + PN + Resultado del período (invariante del balance general). */
export function balanceCuadra(hoja: { activo: bigint; pasivo: bigint; pn: bigint; resultado: bigint }): boolean {
  return hoja.activo === hoja.pasivo + hoja.pn + hoja.resultado;
}

/** Un término de la fórmula de una agrupación de resultado ("Resultado bruto" = 4.1 + 4.2 − 5.1): prefijo de código + signo. */
export type TerminoAgrupacion = { prefijoCodigo: string; signo: 1 | -1 };

/** Evalúa una fórmula de agrupación contra sumas por cuenta ya cargadas (match por prefijo de código, ej. "4.1" matchea "4.1" y "4.1.01"). */
export function evaluarAgrupacion(formula: readonly TerminoAgrupacion[], filas: readonly SumaCuenta[]): bigint {
  let total = 0n;
  for (const termino of formula) {
    for (const f of filas) {
      if (f.codigo === termino.prefijoCodigo || f.codigo.startsWith(`${termino.prefijoCodigo}.`)) {
        total += BigInt(termino.signo) * saldoDeCuenta(f.naturaleza, f.debe, f.haber);
      }
    }
  }
  return total;
}

/** Estado de resultados = Σ cuentas con código que empieza en "4" (ingresos) − Σ cuentas "5" (egresos) — convención habitual de plan de cuentas argentino. */
export function estadoResultadosDeSumas(filas: readonly SumaCuenta[]): bigint {
  let ingresos = 0n;
  let egresos = 0n;
  for (const f of filas) {
    const saldo = saldoDeCuenta(f.naturaleza, f.debe, f.haber);
    if (f.codigo.startsWith("4")) ingresos += saldo;
    else if (f.codigo.startsWith("5")) egresos += saldo;
  }
  return ingresos - egresos;
}

/** Saldo corrido de un mayor: saldo inicial + cada movimiento en orden cronológico. */
export function saldoCorrido(naturaleza: RubroNaturaleza, saldoInicial: bigint, movimientos: readonly { debe: bigint; haber: bigint }[]): bigint[] {
  let saldo = saldoInicial;
  const signo = naturaleza === "activo" || naturaleza === "resultado_negativo" ? 1n : -1n;
  return movimientos.map((m) => {
    saldo += signo * (m.debe - m.haber);
    return saldo;
  });
}

/** Reparto por dimensión (proyecto, sucursal, centro de costo...): "Σ de los grupos + 'sin grupo' = total", por mayor resto para que el chequeo sea exacto en centavos. */
export function totalPorProyecto(filas: readonly { proyectoId: string | null; importe: bigint }[]): { proyectoId: string | null; total: bigint }[] {
  const porProyecto = new Map<string | null, bigint>();
  for (const f of filas) porProyecto.set(f.proyectoId, (porProyecto.get(f.proyectoId) ?? 0n) + f.importe);
  return [...porProyecto.entries()].map(([proyectoId, total]) => ({ proyectoId, total }));
}

export type ProporcionAB = { pctA: number; pctB: number };

/**
 * `proporcionAB`: porcentaje de movimiento que aparece en el libro "A"
 * (oficial) vs. solo en "B" (comprobantes internos), sobre el total de DEBE
 * (partida doble: da lo mismo tomar haber). Reparte por mayor resto para
 * que A% + B% sumen siempre 100.
 */
export function calcularProporcionAB(totalAb: bigint, totalB: bigint): ProporcionAB {
  const total = totalAb + totalB;
  if (total === 0n) return { pctA: 0, pctB: 0 };
  const [pctA, pctB] = repartirPorMayorResto(100n, [Number(totalAb), Number(totalB)]);
  return { pctA: Number(pctA), pctB: Number(pctB) };
}
