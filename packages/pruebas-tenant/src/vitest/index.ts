import { it as itDeVitest } from 'vitest';
import { probarAislamiento, type OpcionesProbarAislamiento } from '../probar-aislamiento.js';

/** Función con la firma de `it`/`test` de vitest: `(nombre, fn) => void`. */
export type RegistrarCaso = (nombre: string, fn: () => Promise<void>) => void;

export interface OpcionesDescribeAislamiento<T> extends OpcionesProbarAislamiento<T> {
  /**
   * Reemplazo de `it` de vitest, solo para testear `describeAislamiento` sin
   * depender del corredor de vitest de verdad (que no puede "fallar a
   * propósito" dentro de la misma suite que lo prueba). La app consumidora
   * nunca necesita pasar esto: por defecto usa el `it` real.
   */
  it?: RegistrarCaso;
}

/**
 * Registra, con `it` de vitest, un test por cada caso de `opciones.casos`:
 * llama a `probarAislamiento` con ESE único caso y hace fallar el test (con
 * el `detalle` del hallazgo en el mensaje) si no clasificó como "no
 * encontrado" — o sea, si el tenant B pudo ver o confirmar el recurso de A.
 *
 * Se llama al nivel superior de un archivo de test (o dentro de un
 * `describe(...)` propio), igual que `it.each`: vitest recolecta los tests
 * durante la carga del archivo, así que el loop de acá corre ANTES de que
 * arranque la suite.
 */
export function describeAislamiento<T>(opciones: OpcionesDescribeAislamiento<T>): void {
  const { it: registrar = itDeVitest, casos, ...resto } = opciones;

  for (const caso of casos) {
    registrar(`aislamiento: ${caso.nombre}`, async () => {
      // `probarAislamiento` devuelve siempre un resultado por caso recibido
      // (acá, exactamente uno): el `!` es seguro por esa garantía, no una
      // apuesta.
      const [resultado] = await probarAislamiento({ ...resto, casos: [caso] } as OpcionesProbarAislamiento<T>);
      if (!resultado!.ok) {
        throw new Error(`Fuga de aislamiento en "${caso.nombre}": ${resultado!.detalle}`);
      }
    });
  }
}
