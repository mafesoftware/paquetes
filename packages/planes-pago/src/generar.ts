/**
 * Generación de cuotas de un plan de pago. Función PURA (sin DB): entra la
 * condición comercial pactada y los feriados del calendario que corresponda,
 * salen las cuotas con su vencimiento y monto base — sin ajuste por índice
 * (eso es responsabilidad de quien consuma este resultado, típicamente
 * combinado con una fórmula de ajuste que se aplica después).
 */
import { redondearComercial, repartirPorMayorResto, type Moneda } from "@mafesoftware/plata-ar";
import { siguienteHabil, sumarMeses } from "@mafesoftware/fechas-ar";

/** Cada cuánto se repiten las cuotas. `"libre"` no tiene paso fijo: las fechas salen de `sistema.fechas`. */
export type Periodicidad = "mensual" | "bimestral" | "trimestral" | "cuatrimestral" | "semestral" | "anual" | "libre";

/**
 * Cómo se reparte `total` entre las `cuotas`:
 * - `"iguales"`: todas iguales salvo la última, que absorbe la diferencia de
 *   redondeo (así se cuadra siempre el total exacto).
 * - `variacion`: cada cuota vale `porcentaje`% menos que la anterior
 *   (geométrico), repartido por mayor resto para que la suma dé exacto.
 * - `manual`: los montos (y, opcionalmente, las fechas) los da quien arma
 *   el plan — típico de un plan a medida que no sigue una regla.
 */
export type SistemaCuotas =
  | "iguales"
  | { tipo: "variacion"; porcentaje: string }
  | { tipo: "manual"; montos: bigint[]; fechas?: string[] };

export interface Condicion {
  concepto: string;
  moneda: Moneda;
  /** Total a repartir entre las cuotas, en centavos. */
  total: bigint;
  cuotas: number;
  periodicidad: Periodicidad;
  /** Vencimiento de la cuota 1, `"YYYY-MM-DD"` (p.ej. la fecha de la firma: puede no coincidir con el día de las cuotas siguientes). */
  primeraFecha: string;
  /** Día del mes de las cuotas 2..N (la 1 siempre vence en `primeraFecha`). */
  diaVencimiento: number | "ultimo";
  sistema: SistemaCuotas;
}

export interface CuotaGenerada {
  numero: number;
  de: number;
  vencimiento: string;
  montoBase: bigint;
  moneda: Moneda;
  concepto: string;
}

const MESES_POR_PERIODICIDAD: Record<Exclude<Periodicidad, "libre">, number> = {
  mensual: 1,
  bimestral: 2,
  trimestral: 3,
  cuatrimestral: 4,
  semestral: 6,
  anual: 12,
};

/** Reparte `total` en `cuotas` partes iguales; la ÚLTIMA absorbe el resto del redondeo ("Σ = total, siempre"). */
function montosIguales(total: bigint, cuotas: number): bigint[] {
  const base = redondearComercial(total, BigInt(cuotas));
  const montos = Array<bigint>(cuotas).fill(base);
  montos[cuotas - 1] = total - base * BigInt(cuotas - 1);
  return montos;
}

/** Cada cuota vale `1 - porcentaje/100` veces la anterior; mayor resto garantiza Σ = total. */
function montosVariacion(total: bigint, cuotas: number, porcentaje: string): bigint[] {
  const factor = 1 - Number(porcentaje) / 100;
  const pesos = Array.from({ length: cuotas }, (_, i) => factor ** i);
  return repartirPorMayorResto(total, pesos);
}

/**
 * El sistema `manual` lo carga a mano quien arma el plan: nada obliga a que
 * `montos` sea coherente con `total`/`cuotas`. Sin este control, `Σ montos
 * ≠ total` genera cuotas que no cuadran contra lo pactado sin que nada lo
 * avise ("Σ cuotas = total, siempre").
 */
function validarSistemaManual(c: Condicion & { sistema: Extract<SistemaCuotas, { tipo: "manual" }> }): void {
  const { montos, fechas } = c.sistema;
  if (montos.length !== c.cuotas) {
    throw new Error(`sistema manual: hay ${montos.length} montos pero la condición tiene ${c.cuotas} cuotas`);
  }
  if (fechas !== undefined && fechas.length !== montos.length) {
    throw new Error(`sistema manual: hay ${fechas.length} fechas pero ${montos.length} montos`);
  }
  const montoInvalido = montos.find((m) => m <= 0n);
  if (montoInvalido !== undefined) {
    throw new Error(`sistema manual: todos los montos tienen que ser positivos (se recibió ${montoInvalido})`);
  }
  const suma = montos.reduce((acc, m) => acc + m, 0n);
  if (suma !== c.total) {
    throw new Error(`sistema manual: la suma de los montos (${suma}) no coincide con el total (${c.total})`);
  }
}

function montosDeCondicion(c: Condicion): bigint[] {
  if (c.sistema === "iguales") return montosIguales(c.total, c.cuotas);
  if (c.sistema.tipo === "variacion") return montosVariacion(c.total, c.cuotas, c.sistema.porcentaje);
  validarSistemaManual(c as Condicion & { sistema: Extract<SistemaCuotas, { tipo: "manual" }> });
  return c.sistema.montos;
}

/** El vencimiento SIN ajustar por día hábil: la cuota 1 vence en `primeraFecha`; las siguientes, cada `paso` meses después, en `diaVencimiento`. */
function vencimientoCrudo(c: Condicion, numero: number): string {
  if (numero === 1) return c.primeraFecha;
  const paso = MESES_POR_PERIODICIDAD[c.periodicidad as Exclude<Periodicidad, "libre">];
  return sumarMeses(c.primeraFecha, (numero - 1) * paso, c.diaVencimiento);
}

/**
 * Genera las cuotas de una condición de pago: monto base por cuota (sin
 * ajuste por índice) y vencimiento, movido al siguiente día hábil cuando cae
 * en fin de semana o feriado (`feriados`, inyectado por quien llama — el
 * calendario de feriados es un dato de cada organización/país, nunca algo
 * que este paquete conozca de antemano).
 *
 * `periodicidad: "libre"` exige `sistema.tipo === "manual"` con `fechas`
 * explícitas (no hay paso fijo del que derivarlas).
 */
export function generarCuotas(c: Condicion, feriados: ReadonlySet<string>): CuotaGenerada[] {
  const fechasManuales = typeof c.sistema === "object" && c.sistema.tipo === "manual" ? c.sistema.fechas : undefined;

  if (c.periodicidad === "libre" && !fechasManuales) {
    throw new Error("periodicidad 'libre' requiere sistema manual con fechas explícitas");
  }

  const montos = montosDeCondicion(c);

  return montos.map((montoBase, i) => {
    const numero = i + 1;
    const fechaCruda = fechasManuales ? fechasManuales[i] : vencimientoCrudo(c, numero);
    if (fechaCruda === undefined) {
      throw new Error(`falta la fecha manual de la cuota ${numero} de ${montos.length}`);
    }
    return {
      numero,
      de: montos.length,
      vencimiento: siguienteHabil(fechaCruda, feriados),
      montoBase,
      moneda: c.moneda,
      concepto: c.concepto,
    };
  });
}
