/**
 * Períodos contables — núcleo PURO. La generación de los períodos
 * mensuales de un ejercicio y el bloqueo por fecha son, en casi todo
 * producto contable, el mismo cálculo: lo que cambia es DÓNDE vive el
 * estado `abierto`/`cerrado` de cada período (una tabla propia del
 * consumidor, con su propio tenant). Este archivo no sabe de eso — recibe
 * o devuelve fechas, nunca consulta nada.
 */

/** Tira cuando una fecha cae en un período cerrado. `periodo` es el primer día del mes (`YYYY-MM-01`) para que el consumidor lo use de clave. */
export class ErrorPeriodoCerrado extends Error {
  constructor(public readonly periodo: string) {
    super("periodo_cerrado");
    this.name = "ErrorPeriodoCerrado";
  }
}

/** `"2026-08-31"` → `"2026-08-01"` (primer día del mes — clave habitual de una tabla de períodos contables). */
export function primerDiaDelMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

/**
 * Los 12 períodos mensuales (`YYYY-MM-01`) de un ejercicio anual,
 * `desde`–`hasta` (ambos `YYYY-MM-DD`) — el consumidor los persiste como
 * `abierto`. No valida solapamiento entre ejercicios (eso depende del
 * historial que guarde cada consumidor); acá solo arma la lista.
 */
export function periodosMensualesDe(desde: string): string[] {
  const periodos: string[] = [];
  const [anioDesdeRaw, mesDesdeRaw] = desde.slice(0, 7).split("-");
  const anioDesde = Number(anioDesdeRaw);
  const mesDesde = Number(mesDesdeRaw);
  for (let i = 0; i < 12; i++) {
    const mesIndice = mesDesde - 1 + i;
    const anio = anioDesde + Math.floor(mesIndice / 12);
    const mes = (mesIndice % 12) + 1;
    periodos.push(`${anio}-${String(mes).padStart(2, "0")}-01`);
  }
  return periodos;
}

/**
 * El contrato central para quien escribe con una fecha contable: tira
 * `ErrorPeriodoCerrado` si `estado` (ya consultado por el consumidor para
 * el período de `fecha`) es `"cerrado"`. Sin fila en la tabla de períodos
 * = compatibilidad hacia atrás = `"abierto"` (el consumidor pasa
 * `"abierto"` cuando no encuentra fila, nunca al revés) — esta función no
 * decide eso, solo tira o no según lo que ya se resolvió.
 */
export function exigirPeriodoAbierto(estado: "abierto" | "cerrado", fecha: string): void {
  if (estado === "cerrado") throw new ErrorPeriodoCerrado(primerDiaDelMes(fecha));
}
