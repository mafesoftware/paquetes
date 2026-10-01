/**
 * Ajuste por inflación RT 6 (reexpresión de rubros no monetarios y del
 * patrimonio neto) — dominio PURO (Tarea 4.30, spec 40, `contratos.md` de
 * Fase 4: `ajustarPorInflacion(ejercicioId, { indice: "IPC_FACPCE" })`).
 *
 * Sin DB: recibe una tabla de fixture explícita por rubro (spec 40,
 * restricción global de la fase: "los tests de dominio usan tablas de
 * fixture explícitas... para que la aritmética no dependa del seed") — cada
 * rubro trae su valor histórico y el índice vigente en su fecha de origen y
 * en la fecha de cierre; este archivo NO sabe de qué tabla salió el índice
 * ni cómo se determinó la fecha de origen de cada rubro (eso es
 * `src/lib/contabilidad/inflacion.ts`, server-only).
 *
 * Coeficiente = índice(cierre) / índice(origen), redondeado comercial a 8
 * decimales (`factorEntre` de `@mafesoftware/plata-ar` — mismo mecanismo
 * que `plata.ts` usa para ajuste por índice de cuotas). Ajuste = valor ×
 * (coeficiente − 1) = `aplicarFactor(valor, coeficiente) − valor`.
 *
 * Un rubro de ACTIVO no monetario (bien de uso, etc.) se reexpresa
 * DEBITÁNDOLO por el ajuste (aumenta su valor de libro); uno de PATRIMONIO
 * NETO (capital, aportes) se reexpresa ACREDITÁNDOLO. La diferencia entre
 * lo debitado y lo acreditado por estas líneas es el "resultado por
 * exposición a la inflación" (REI, RECPAM): contrapartida en `cuentaReiId`.
 */
import { aplicarFactor, factorEntre } from "@mafesoftware/plata-ar";

export type RubroAjustableRT6 = {
  cuentaId: string;
  /** `true` = cuenta de patrimonio neto (se acredita); `false` = activo/rubro no monetario (se debita). */
  esPatrimonioNeto: boolean;
  /** Valor de libro a la fecha de origen (ARS, centavos), antes de este ajuste. */
  valorHistorico: bigint;
  /** Valor del índice en la fecha de origen del rubro (puede ser anterior al inicio del ejercicio: capital viejo, bienes de uso de otro año). */
  indiceOrigen: string;
  /** Valor del índice a la fecha de cierre del ejercicio. */
  indiceCierre: string;
};

export type LineaRT6 = { cuentaId: string; debe: bigint; haber: bigint; detalle: string };

export type DetalleAjusteRT6 = { cuentaId: string; coeficiente: string; ajuste: bigint };

export type ResultadoRT6 = { lineas: LineaRT6[]; detalle: DetalleAjusteRT6[] };

/** `índice(cierre) / índice(origen)`, redondeado comercial a 8 decimales. */
export function coeficienteRT6(indiceOrigen: string, indiceCierre: string): string {
  return factorEntre(indiceCierre, indiceOrigen);
}

/**
 * Arma las líneas de reexpresión de todos los rubros + la contrapartida de
 * REI que hace falta para balancear. Un rubro con ajuste `0n` (índice sin
 * variación entre origen y cierre) no genera línea.
 */
export function ajustePorRT6(rubros: readonly RubroAjustableRT6[], cuentaReiId: string): ResultadoRT6 {
  const lineas: LineaRT6[] = [];
  const detalle: DetalleAjusteRT6[] = [];
  let totalDebe = 0n;
  let totalHaber = 0n;

  for (const r of rubros) {
    const coeficiente = coeficienteRT6(r.indiceOrigen, r.indiceCierre);
    const valorAjustado = aplicarFactor(r.valorHistorico, coeficiente);
    const ajuste = valorAjustado - r.valorHistorico;
    detalle.push({ cuentaId: r.cuentaId, coeficiente, ajuste });
    if (ajuste === 0n) continue;

    if (r.esPatrimonioNeto) {
      if (ajuste > 0n) {
        lineas.push({ cuentaId: r.cuentaId, debe: 0n, haber: ajuste, detalle: "RT 6 — reexpresión por inflación" });
        totalHaber += ajuste;
      } else {
        lineas.push({ cuentaId: r.cuentaId, debe: -ajuste, haber: 0n, detalle: "RT 6 — reexpresión por inflación" });
        totalDebe += -ajuste;
      }
    } else {
      if (ajuste > 0n) {
        lineas.push({ cuentaId: r.cuentaId, debe: ajuste, haber: 0n, detalle: "RT 6 — reexpresión por inflación" });
        totalDebe += ajuste;
      } else {
        lineas.push({ cuentaId: r.cuentaId, debe: 0n, haber: -ajuste, detalle: "RT 6 — reexpresión por inflación" });
        totalHaber += -ajuste;
      }
    }
  }

  const diferencia = totalHaber - totalDebe;
  if (diferencia > 0n) {
    lineas.push({ cuentaId: cuentaReiId, debe: diferencia, haber: 0n, detalle: "RT 6 — resultado por exposición a la inflación (REI)" });
  } else if (diferencia < 0n) {
    lineas.push({ cuentaId: cuentaReiId, debe: 0n, haber: -diferencia, detalle: "RT 6 — resultado por exposición a la inflación (REI)" });
  }

  return { lineas, detalle };
}
