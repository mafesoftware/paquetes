/**
 * Frontera `bigint` ↔ `string` para persistir una `TablaGanancias` en una
 * columna `jsonb` (p.ej. la config de un régimen/concepto, global o con
 * override por organización): un `bigint` no es serializable por
 * `JSON.stringify` (Drizzle tira "Do not know how to serialize a BigInt"
 * al insertar). PURO: sin DB.
 */
import type { EscalaTramo, EscalaTramoSerializada, TablaGanancias, TablaGananciasSerializada } from "./tipos.js";

function serializarEscala(escala: EscalaTramo[]): EscalaTramoSerializada[] {
  return escala.map((t) => ({ desde: t.desde.toString(), hasta: t.hasta === null ? null : t.hasta.toString(), fijo: t.fijo.toString(), porcentaje: t.porcentaje }));
}

function deserializarEscala(escala: EscalaTramoSerializada[]): EscalaTramo[] {
  return escala.map((t) => ({ desde: BigInt(t.desde), hasta: t.hasta === null ? null : BigInt(t.hasta), fijo: BigInt(t.fijo), porcentaje: t.porcentaje }));
}

export function serializarTablaGanancias(tabla: TablaGanancias): TablaGananciasSerializada {
  return {
    concepto: tabla.concepto,
    codigoSicore: tabla.codigoSicore,
    minimoNoSujeto: tabla.minimoNoSujeto.toString(),
    alicuotaInscripto: tabla.alicuotaInscripto,
    alicuotaNoInscripto: tabla.alicuotaNoInscripto,
    ...(tabla.escala ? { escala: serializarEscala(tabla.escala) } : {}),
    retencionMinima: tabla.retencionMinima.toString(),
  };
}

export function deserializarTablaGanancias(tabla: TablaGananciasSerializada): TablaGanancias {
  return {
    concepto: tabla.concepto,
    codigoSicore: tabla.codigoSicore,
    minimoNoSujeto: BigInt(tabla.minimoNoSujeto),
    alicuotaInscripto: tabla.alicuotaInscripto,
    alicuotaNoInscripto: tabla.alicuotaNoInscripto,
    ...(tabla.escala ? { escala: deserializarEscala(tabla.escala) } : {}),
    retencionMinima: BigInt(tabla.retencionMinima),
  };
}
