/**
 * Decisión de negocio de "archivar un proveedor": PURA, sin DB — quien
 * llama consulta el saldo real y le pasa el booleano acá.
 */
export type DecisionArchivarProveedor = { ok: true } | { ok: false; error: string; requiereConfirmacion: true };

/**
 * Archivar SIN saldo pendiente siempre procede. Con saldo pendiente, hace
 * falta `confirmado: true` ("archivar con saldo → confirmación explícita
 * requerida") — nunca bloquea para siempre, solo exige que quien archiva lo
 * haga a sabiendas.
 */
export function decidirArchivarProveedor(opts: { tieneSaldoPendiente: boolean; confirmado: boolean }): DecisionArchivarProveedor {
  if (opts.tieneSaldoPendiente && !opts.confirmado) {
    return {
      ok: false,
      error: "Este proveedor tiene saldo pendiente. Confirmá para archivarlo igual.",
      requiereConfirmacion: true,
    };
  }
  return { ok: true };
}
