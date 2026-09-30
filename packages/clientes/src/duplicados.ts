/**
 * Detección de duplicados de un cliente/prospecto por email, teléfono o
 * documento: acá SOLO la normalización pura, sin DB — la app la usa para
 * buscar un registro activo con el mismo valor normalizado antes de
 * insertar (o para sugerir una fusión).
 *
 * Núcleo puro: sin DB ni framework, sin `process.env`.
 */

/**
 * Normaliza un teléfono argentino para comparar duplicados: solo dígitos,
 * sin el código de país (`54`), sin el `9` de celular, sin el `0` de
 * discado local — así `"+54 9 11 1234-5678"` y `"11 1234-5678"` normalizan
 * al mismo valor.
 *
 * Nunca tira: un teléfono vacío o sin dígitos normaliza a cadena vacía
 * (`esMismoTelefono` trata dos cadenas vacías como "no comparable", nunca
 * como duplicado).
 */
export function normalizarTelefono(telefono: string | null | undefined): string {
  if (!telefono) return '';
  let digitos = telefono.replace(/\D/g, '');
  if (digitos.startsWith('54')) digitos = digitos.slice(2);
  if (digitos.startsWith('9')) digitos = digitos.slice(1);
  if (digitos.startsWith('0')) digitos = digitos.slice(1);
  return digitos;
}

/** ¿Dos teléfonos son el mismo número, normalizados? Cadenas vacías nunca "coinciden" entre sí. */
export function esMismoTelefono(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizarTelefono(a);
  const nb = normalizarTelefono(b);
  return na !== '' && na === nb;
}

/** Normaliza un DNI/documento a solo dígitos, para comparar duplicados. */
export function normalizarDni(dni: string | null | undefined): string {
  return dni ? dni.replace(/\D/g, '') : '';
}

/** Normaliza un email para comparar duplicados: minúsculas, sin espacios de borde. */
export function normalizarEmail(email: string | null | undefined): string {
  return email ? email.trim().toLowerCase() : '';
}
