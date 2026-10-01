/**
 * Tipos compartidos de retenciones — los cálculos (`ganancias.ts`,
 * `iva.ts`, `suss.ts`, `iibb.ts`) los reusan tal cual, no los redeclaran.
 */

export type Regimen = "ganancias" | "iva" | "suss" | "iibb";

/** `"ARBA" | "AGIP"` son las conocidas hoy; el tipo queda abierto (`string`) para otras jurisdicciones de IIBB. */
export type Jurisdiccion = "ARBA" | "AGIP" | string;

export type Exclusion = {
  regimen: Regimen;
  /** `100` = exclusión total. String decimal (`porcentaje()`, `numeric(11,8)`), nunca `number`. */
  porcentaje: string;
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD
  certificado: string;
};

export type EscalaTramo = { desde: bigint; hasta: bigint | null; fijo: bigint; porcentaje: string };

export type TablaGanancias = {
  concepto: string;
  codigoSicore: string;
  minimoNoSujeto: bigint;
  alicuotaInscripto: string | "escala";
  alicuotaNoInscripto: string;
  escala?: EscalaTramo[];
  retencionMinima: bigint;
};

/**
 * Misma forma que `EscalaTramo`/`TablaGanancias` pero con los `bigint`
 * como `string` (`JSON.stringify` no sabe serializar un `bigint`, tira "Do
 * not know how to serialize a BigInt"). Para persistir una `TablaGanancias`
 * en una columna `jsonb`, `serializarTablaGanancias`/
 * `deserializarTablaGanancias` (`serializacion.ts`) convierten entre las
 * dos formas.
 */
export type EscalaTramoSerializada = { desde: string; hasta: string | null; fijo: string; porcentaje: string };

export type TablaGananciasSerializada = {
  concepto: string;
  codigoSicore: string;
  minimoNoSujeto: string;
  alicuotaInscripto: string | "escala";
  alicuotaNoInscripto: string;
  escala?: EscalaTramoSerializada[];
  retencionMinima: string;
};

export type TipoPadron = "retencion" | "percepcion";

/** Una fila normalizada del padrón (ya parseada), sin `organizacionId`/`origen` — eso lo agrega quien la persiste/consulta. */
export type FilaPadron = {
  cuit: string;
  tipo: TipoPadron;
  /** String decimal (`"1.75"`), con el punto ya normalizado (el archivo trae coma). */
  alicuota: string;
  vigenteDesde: string; // YYYY-MM-DD
  vigenteHasta: string | null; // YYYY-MM-DD | null = sin fin
  grupo: string | null;
  razonSocialContribuyente: string | null;
};

/** `FilaPadron` + de dónde salió (para que un override de la organización gane sobre el global). */
export type FilaPadronConOrigen = FilaPadron & { origen: "global" | "organizacion" };

export type ErrorImportacionPadron = { fila: number; error: string };

/**
 * Resultado de calcular una retención: la
 * base y alícuota EFECTIVAMENTE usadas (después de mínimo no sujeto,
 * escala o convenio multilateral, según el régimen), el `importe` final
 * (después de exclusión y de la retención mínima) y una `explicacion`
 * legible para mostrar en la vista previa de la OP/cobro.
 */
export type CalculoRetencion = {
  regimen: Regimen;
  concepto: string;
  base: bigint;
  alicuota: string;
  minimoNoSujeto: bigint;
  importe: bigint;
  exclusionAplicada: Exclusion | null;
  explicacion: string;
};
