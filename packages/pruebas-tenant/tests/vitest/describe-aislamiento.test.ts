import { describe, expect, it } from 'vitest';
import { describeAislamiento, type RegistrarCaso } from '../../src/vitest/index.js';
import type { CasoAislamiento } from '../../src/index.js';

interface Tenant {
  id: string;
}

/**
 * `describeAislamiento` llama a `it()` de verdad para registrar un test por
 * caso — no se puede probar "de afuera" haciendo que un caso con fuga falle
 * la suite (eso rompería justamente el archivo que lo prueba). Por eso acepta
 * un `it` inyectable (`RegistrarCaso`, solo para tests): acá se captura cada
 * `(nombre, fn)` que registraría, y se corre `fn()` A MANO para afirmar que
 * rechaza (caso con fuga) o resuelve (caso sano) — igual que vitest lo haría,
 * pero dentro de un `expect` en vez de como una suite real.
 */
function capturarRegistros(): { it: RegistrarCaso; registrados: Map<string, () => Promise<void>> } {
  const registrados = new Map<string, () => Promise<void>>();
  const it: RegistrarCaso = (nombre, fn) => {
    registrados.set(nombre, fn);
  };
  return { it, registrados };
}

describe('describeAislamiento', () => {
  const sembrar = async (): Promise<{ a: Tenant; b: Tenant; idDeA: string }> => ({
    a: { id: 'a' },
    b: { id: 'b' },
    idDeA: 'recurso-1',
  });
  const esNoEncontrado = (r: unknown): boolean => r === null;

  it('registra un it() por caso, con el nombre prefijado', () => {
    const { it: itFalso, registrados } = capturarRegistros();
    const casos: CasoAislamiento<Tenant>[] = [
      { nombre: 'uno', ejecutar: async () => null },
      { nombre: 'dos', ejecutar: async () => null },
    ];

    describeAislamiento({ casos, sembrar, esNoEncontrado, it: itFalso });

    expect([...registrados.keys()]).toEqual(['aislamiento: uno', 'aislamiento: dos']);
  });

  it('el test de un caso sano resuelve sin tirar', async () => {
    const { it: itFalso, registrados } = capturarRegistros();
    const casos: CasoAislamiento<Tenant>[] = [{ nombre: 'sano', ejecutar: async () => null }];

    describeAislamiento({ casos, sembrar, esNoEncontrado, it: itFalso });

    const fn = registrados.get('aislamiento: sano');
    expect(fn).toBeDefined();
    await expect(fn!()).resolves.toBeUndefined();
  });

  it('el test de un caso con fuga TIRA (así vitest lo reporta como fallido)', async () => {
    const { it: itFalso, registrados } = capturarRegistros();
    const casos: CasoAislamiento<Tenant>[] = [
      // Fuga a propósito: devuelve un dato en vez de clasificar como "no encontrado".
      { nombre: 'con fuga', ejecutar: async () => ({ secreto: 'dato de A' }) },
    ];

    describeAislamiento({ casos, sembrar, esNoEncontrado, it: itFalso });

    const fn = registrados.get('aislamiento: con fuga');
    expect(fn).toBeDefined();
    await expect(fn!()).rejects.toThrow(/Fuga de aislamiento en "con fuga"/);
  });

  // Sin `it` inyectado: ejercita la rama por defecto (`it` real de vitest),
  // registrando un test de verdad como hermano de los `it(...)` de arriba —
  // exactamente como lo llamaría una app consumidora. Tiene que quedar en
  // verde: el caso es sano.
  describeAislamiento({
    casos: [{ nombre: 'con it real de vitest', ejecutar: async () => null }],
    sembrar,
    esNoEncontrado,
  });
});
