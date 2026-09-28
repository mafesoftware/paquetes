import { periodoDe, sumarPeriodos, type Periodo } from "@mafesoftware/fechas-ar";
import { ErrorIndices } from "./errores.js";

/**
 * La regla de referencia de un contrato (spec 02 §3.2):
 *
 * - `desfase`: el período de referencia es el de vencimiento menos `meses`
 *   (por defecto 2 en el producto, pero acá `meses` siempre es explícito).
 * - `ultimo_publicado`: el último período publicado a la fecha de
 *   vencimiento (o de pago) — lo decide quien llama, `periodoReferencia`
 *   solo lo devuelve tal cual (o `null` si todavía no se publicó nada).
 */
export type ReglaReferencia = { tipo: "desfase"; meses: number } | { tipo: "ultimo_publicado" };

/**
 * El período de índice que corresponde usar para ajustar una cuota que
 * vence el `vencimiento` dado, según la `regla` del contrato.
 *
 * `ultimoPublicado` es el último período publicado de ESE índice A LA FECHA
 * relevante (vencimiento o pago, según config del contrato) — este paquete
 * no lo calcula (no tiene acceso a la base de valores), solo lo devuelve
 * cuando la regla es `"ultimo_publicado"`.
 *
 * @example
 * periodoReferencia("2026-09-10", { tipo: "desfase", meses: 2 }, null); // "2026-07"
 * @example
 * periodoReferencia("2026-09-10", { tipo: "ultimo_publicado" }, null); // null: nada publicado todavía
 * @example
 * periodoReferencia("2026-09-10", { tipo: "ultimo_publicado" }, "2026-08"); // "2026-08"
 */
export function periodoReferencia(
  vencimiento: string,
  regla: ReglaReferencia,
  ultimoPublicado: Periodo | null,
): Periodo | null {
  if (regla.tipo === "ultimo_publicado") return ultimoPublicado;

  if (!Number.isInteger(regla.meses) || regla.meses < 0) {
    throw new ErrorIndices(
      "regla_invalida",
      `periodoReferencia: "meses" de una regla de desfase tiene que ser un entero >= 0 (fue ${regla.meses}).`,
    );
  }

  const periodoVencimiento = periodoDe(vencimiento);
  return sumarPeriodos(periodoVencimiento, -regla.meses);
}
