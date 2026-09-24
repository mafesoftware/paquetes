/** Opciones de `formatearNumero`. Todas opcionales: sin ninguna, el número sale tal cual (`"699401"`). */
export interface OpcionesFormatearNumero {
  /** Va ANTES del número, tal cual (ej. `"R-"`). Vacío por defecto. */
  prefijo?: string;
  /** A cuántos dígitos rellenar el número con ceros a la izquierda. `0` por defecto (sin relleno). */
  relleno?: number;
  /** Va DESPUÉS del número, tal cual. Vacío por defecto. */
  sufijo?: string;
}

/**
 * Formatea un número correlativo: rellena con ceros a la izquierda hasta
 * `relleno` dígitos y le pone `prefijo`/`sufijo` alrededor.
 *
 * **Nunca trunca.** `String.prototype.padStart` no corta nada cuando la
 * cadena ya es más larga que el ancho pedido — a diferencia del `lpad` de
 * Postgres, que si el texto ya mide más que el ancho lo TRUNCA en vez de
 * dejarlo pasar (`lpad('10000', 4, '0')` da `'1000'`, no `'10000'`). Ese bug
 * vivía en `numeracion.ts` de store360 (comentario que afirmaba lo
 * contrario) y explotó en producción: un comercio con números de seis
 * dígitos arrastrados de una numeración vieja por `Date.now()` (`699401`) se
 * encontró generando `1000` — que ya existía — y no pudo emitir ni un
 * comprobante más. Acá el ancho pedido es un PISO, nunca un techo.
 *
 * ```ts
 * import { formatearNumero } from "@mafesoftware/numeradores";
 *
 * formatearNumero(7n, { prefijo: "R-", relleno: 4 }); // "R-0007"
 * formatearNumero(699401n, { prefijo: "R-", relleno: 4 }); // "R-699401" (NO trunca a "R-9940")
 * formatearNumero(42n); // "42" (sin relleno ni prefijo/sufijo)
 * formatearNumero(3n, { prefijo: "OP-", relleno: 6, sufijo: "-A" }); // "OP-000003-A"
 * ```
 */
export function formatearNumero(n: bigint, opciones: OpcionesFormatearNumero = {}): string {
  const { prefijo = "", relleno = 0, sufijo = "" } = opciones;
  return `${prefijo}${n.toString().padStart(relleno, "0")}${sufijo}`;
}
