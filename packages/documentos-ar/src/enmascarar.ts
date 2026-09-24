/**
 * Enmascara un string dejando visibles los últimos `visibles` caracteres: el
 * resto se reemplaza por `"*"`. Sirve para mostrar un CBU, un DNI o un CUIT
 * en una pantalla sin exponerlo entero.
 *
 * Con un `valor` que no llega a `visibles` caracteres, se devuelve tal cual
 * — no hay nada que ocultar sin dejarlo irreconocible. Con `visibles <= 0`
 * se enmascara entero.
 *
 * @example
 * enmascarar("2850590940090418135201"); // "******************5201"
 */
export function enmascarar(valor: string, visibles = 4): string {
  if (visibles <= 0) return "*".repeat(valor.length);
  if (valor.length <= visibles) return valor;
  return "*".repeat(valor.length - visibles) + valor.slice(-visibles);
}
