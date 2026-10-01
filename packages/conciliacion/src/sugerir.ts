/**
 * Motor de sugerencias de conciliación bancaria: `sugerirMatches` cruza las
 * líneas de un extracto ya parseado (`ExtractoCuenta.lineas`, ver
 * `motor.ts`) contra los movimientos conciliables del sistema que integra
 * este paquete (cobros, órdenes de pago, transferencias) y propone matches
 * por tres reglas, en orden de certeza decreciente:
 *
 * 1. `referencia_cuit` — mismo importe y el CUIT de la contraparte del
 *    movimiento aparece en la descripción de la línea (desambigua importes
 *    repetidos que `importe_fecha` dejaría ambiguos).
 * 2. `importe_fecha` — mismo importe exacto y única línea/movimiento
 *    candidato dentro de `toleranciaDias`; ambiguo (>1 candidato) → sin
 *    sugerencia por esta regla (puede resolverse por CUIT o quedar sin
 *    matchear).
 * 3. `combinacion` — una línea sin match directo cuya suma con 2..
 *    `maxCombinacion` movimientos del mismo signo, dentro de la ventana de
 *    fecha, coincide exacto (ver `combinaciones.ts`).
 *
 * Ninguna línea ni movimiento se sugiere dos veces: cada regla consume de
 * los mismos sets `lineasUsadas`/`movsUsados`, en el orden de arriba.
 *
 * Tipos LOCALES a este módulo (puro, sin DB): `LineaExtracto` tiene la
 * misma forma que la de `motor.ts` (parseo de archivos, con I/O) pero no se
 * importa de ahí a propósito, para que este módulo de matching siga siendo
 * usable con movimientos/líneas que vengan de cualquier otro lado (no solo
 * de un archivo parseado acá).
 *
 * `diasEntre` es de `@mafesoftware/fechas-ar` (API 0.2, calendario puro),
 * que devuelve la diferencia CON signo — acá solo importa la distancia, así
 * que se usa en valor absoluto.
 *
 * La extracción/normalización de CUIT de la regla `referencia_cuit` es una
 * comparación de dígitos simple (sin validar dígito verificador): la
 * descripción de un extracto es texto libre de un banco, no un formulario
 * — exigir que matchee `@mafesoftware/documentos-ar#validarCuit` rechazaría
 * de más (un banco puede truncar o espaciar distinto el CUIT en el texto).
 * Quien integra este paquete puede validar el CUIT de sus propios
 * movimientos por su cuenta si lo necesita.
 */

import { diasEntre } from "@mafesoftware/fechas-ar";
import { buscarCombinacion } from "./combinaciones.js";

export type LineaExtracto = {
  id: string;
  fecha: string; // ISO YYYY-MM-DD
  descripcion: string;
  importe: bigint; // centavos, CON signo
  saldo: bigint | null;
  referencia: string | null;
};

export type MovConciliable = {
  id: string;
  fecha: string; // ISO YYYY-MM-DD
  importe: bigint; // centavos, CON signo
  referencia: string | null;
  cuitContraparte: string | null;
};

export type ReglaSugerencia = "importe_fecha" | "referencia_cuit" | "combinacion";

export type Sugerencia = {
  lineaIds: string[];
  movimientoIds: string[];
  regla: ReglaSugerencia;
  confianza: number; // 0..1
  diferenciaDias: number;
};

export type OpcionesSugerir = { toleranciaDias: number; maxCombinacion: number };

const REGEX_CUIT = /\b(\d{2}-?\d{8}-?\d)\b/;

function normalizarCuit(cuit: string): string {
  return cuit.replace(/-/g, "");
}

function extraerCuit(texto: string): string | null {
  const m = texto.match(REGEX_CUIT);
  return m ? normalizarCuit(m[1]!) : null;
}

function diasEntreAbs(a: string, b: string): number {
  return Math.abs(diasEntre(a, b));
}

function mismoSigno(a: bigint, b: bigint): boolean {
  return (a < 0n) === (b < 0n);
}

export function sugerirMatches(
  lineas: readonly LineaExtracto[],
  movs: readonly MovConciliable[],
  opciones: OpcionesSugerir,
): Sugerencia[] {
  const lineasUsadas = new Set<string>();
  const movsUsados = new Set<string>();
  const sugerencias: Sugerencia[] = [];

  // 1) referencia_cuit
  for (const linea of lineas) {
    if (lineasUsadas.has(linea.id)) continue;
    const cuitLinea = extraerCuit(linea.descripcion);
    if (!cuitLinea) continue;

    const candidatos = movs.filter(
      (m) =>
        !movsUsados.has(m.id) &&
        m.importe === linea.importe &&
        m.cuitContraparte != null &&
        normalizarCuit(m.cuitContraparte) === cuitLinea,
    );
    if (candidatos.length !== 1) continue;

    const mov = candidatos[0]!;
    const dd = diasEntreAbs(linea.fecha, mov.fecha);
    if (dd > opciones.toleranciaDias) continue;

    sugerencias.push({ lineaIds: [linea.id], movimientoIds: [mov.id], regla: "referencia_cuit", confianza: 0.97, diferenciaDias: dd });
    lineasUsadas.add(linea.id);
    movsUsados.add(mov.id);
  }

  // 2) importe_fecha
  for (const linea of lineas) {
    if (lineasUsadas.has(linea.id)) continue;

    const candidatos = movs.filter(
      (m) => !movsUsados.has(m.id) && m.importe === linea.importe && diasEntreAbs(linea.fecha, m.fecha) <= opciones.toleranciaDias,
    );
    if (candidatos.length !== 1) continue; // ambiguo → no sugiere por esta regla

    const mov = candidatos[0]!;
    const dd = diasEntreAbs(linea.fecha, mov.fecha);
    const confianza = dd === 0 ? 1 : Math.max(0.5, 1 - dd / (opciones.toleranciaDias + 1));

    sugerencias.push({ lineaIds: [linea.id], movimientoIds: [mov.id], regla: "importe_fecha", confianza, diferenciaDias: dd });
    lineasUsadas.add(linea.id);
    movsUsados.add(mov.id);
  }

  // 3) combinacion
  if (opciones.maxCombinacion >= 2) {
    for (const linea of lineas) {
      if (lineasUsadas.has(linea.id)) continue;

      const candidatos = movs
        .filter((m) => !movsUsados.has(m.id) && mismoSigno(m.importe, linea.importe) && diasEntreAbs(linea.fecha, m.fecha) <= opciones.toleranciaDias)
        .sort((a, b) => diasEntreAbs(linea.fecha, a.fecha) - diasEntreAbs(linea.fecha, b.fecha));

      const combo = buscarCombinacion(linea.importe, candidatos, opciones.maxCombinacion);
      if (!combo) continue;

      const movsCombo = combo.map((id) => movs.find((m) => m.id === id)!);
      const maxDiff = Math.max(...movsCombo.map((m) => diasEntreAbs(linea.fecha, m.fecha)));

      sugerencias.push({ lineaIds: [linea.id], movimientoIds: combo, regla: "combinacion", confianza: 0.8, diferenciaDias: maxDiff });
      lineasUsadas.add(linea.id);
      combo.forEach((id) => movsUsados.add(id));
    }
  }

  return sugerencias;
}
