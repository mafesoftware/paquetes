/** Un archivo de código fuente ya leído: ruta (para reportar) y su texto. */
export interface ArchivoFuente {
  /** Ruta a reportar en el `Hallazgo` (relativa, típicamente). No se usa para leer nada. */
  ruta: string;
  texto: string;
}

/** Lo que encuentra un detector: qué regla, en qué archivo y línea, y el detalle para quien lo lea. */
export interface Hallazgo {
  regla: string;
  archivo: string;
  linea: number;
  detalle: string;
}

/** Un detector analiza UN archivo y devuelve sus hallazgos (puede ser ninguno). */
export type Detector = (archivo: ArchivoFuente) => Hallazgo[];
