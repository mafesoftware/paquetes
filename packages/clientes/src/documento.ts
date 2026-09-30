/**
 * Documento de identificación de un cliente (DNI o CUIT): compone
 * `@mafesoftware/documentos-ar` (el algoritmo del dígito verificador vive
 * ahí — este paquete nunca lo reimplementa).
 *
 * Núcleo puro: sin DB ni framework, sin `process.env`.
 */
import { validarCuit, validarDni } from '@mafesoftware/documentos-ar';

export type TipoDocumentoCliente = 'dni' | 'cuit';

export type ResultadoDocumentoCliente = { ok: true; normalizado: string } | { ok: false; mensaje: string };

/** Valida y normaliza un DNI o un CUIT según `tipo`. Nunca tira. */
export function validarDocumentoCliente(tipo: TipoDocumentoCliente, valor: string): ResultadoDocumentoCliente {
  const resultado = tipo === 'dni' ? validarDni(valor) : validarCuit(valor);
  if (!resultado.ok) return { ok: false, mensaje: resultado.mensaje };
  return { ok: true, normalizado: resultado.normalizado };
}
