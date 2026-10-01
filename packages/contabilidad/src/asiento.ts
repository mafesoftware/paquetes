/**
 * Asiento contable — núcleo PURO. La FORMA de un asiento de partida doble y
 * si balancea (Σ debe === Σ haber). Quién arma un `Asiento` a partir de un
 * documento de negocio (factura, cobro, orden de pago...) y quién lo
 * persiste es responsabilidad del consumidor — ese mapeo es específico de
 * cada producto (ver `mapeos.ts` para el vocabulario de resolución de
 * cuentas que sí es genérico).
 */
import type { Moneda } from "@mafesoftware/plata-ar";

/** Vocabulario libre de "libro" (p.ej. `"A"` = libro oficial, `"B"` = solo gestión) — el consumidor define sus propios valores. */
export type Libro = string;

export type TipoAsiento = "automatico" | "manual" | "apertura" | "cierre" | "refundicion" | "ajuste_inflacion" | "revaluacion";

export type LineaAsiento = {
  cuentaId: string;
  /** En la moneda de informe del asiento (ya convertida si la línea es de otra moneda — ver `moneda`/`importeOriginal`/`tc`). */
  debe: bigint;
  haber: bigint;
  moneda: Moneda;
  /** El monto en `moneda` (igual a `debe`/`haber` cuando `moneda` es la de informe). */
  importeOriginal: bigint;
  tc: string | null;
  /** Dimensión de análisis opcional (centro de costo, proyecto, sucursal...) — el consumidor decide qué significa. */
  proyectoId: string | null;
  centroCostoId: string | null;
  detalle: string;
};

export type Asiento = {
  fecha: string;
  libro: Libro;
  tipo: TipoAsiento;
  origen: { tipo: string; id: string } | null;
  leyenda: string;
  lineas: LineaAsiento[];
};

/** Σ debe === Σ haber, en la moneda de informe del asiento. */
export function balancea(a: Asiento): boolean {
  let debe = 0n;
  let haber = 0n;
  for (const l of a.lineas) {
    debe += l.debe;
    haber += l.haber;
  }
  return debe === haber;
}

/**
 * Contraasiento espejo de una anulación: misma estructura, debe↔haber
 * invertidos, con la fecha de anulación. Mismas líneas (mismas cuentas,
 * mismos importes, misma moneda original).
 */
export function espejo(original: Asiento, fechaAnulacion: string, origen: { tipo: string; id: string }): Asiento {
  return {
    fecha: fechaAnulacion,
    libro: original.libro,
    tipo: "automatico",
    origen,
    leyenda: `Anulación — ${original.leyenda}`,
    lineas: original.lineas.map((l) => ({ ...l, debe: l.haber, haber: l.debe })),
  };
}
