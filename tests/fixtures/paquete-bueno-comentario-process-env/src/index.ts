/**
 * Nota (documentación, no código): esta función NO lee `process.env` para
 * nada — antes de la fix, un comentario que solo MENCIONA `process.env`
 * (como esta misma frase) hacía que `verificarPaquete` rechazara el paquete
 * igual, aunque el núcleo fuera puro de verdad.
 */
export function saludar(nombre: string): string {
  // otro comentario de línea que también menciona process.env, a propósito.
  return `Hola, ${nombre}!`;
}
