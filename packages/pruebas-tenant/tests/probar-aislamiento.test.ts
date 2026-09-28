import { describe, expect, it, vi } from 'vitest';
import { probarAislamiento, type CasoAislamiento } from '../src/index.js';

interface Tenant {
  id: string;
}

interface Recurso {
  tenantId: string;
  secreto: string;
}

class ErrorNoEncontrado extends Error {
  constructor() {
    super('NoEncontrado');
    this.name = 'ErrorNoEncontrado';
  }
}

/**
 * Escenario de ejemplo: una "base" compartida (un Map) y tres formas de leer
 * un recurso por id — dos correctas (filtran por tenant, una devolviendo
 * `null` y la otra tirando) y una CON LA FUGA a propósito (no filtra), que es
 * el caso que `probarAislamiento` tiene que reportar como filtrado.
 */
function crearEscenario() {
  const db = new Map<string, Recurso>();
  let contador = 0;

  async function sembrar(): Promise<{ a: Tenant; b: Tenant; idDeA: string }> {
    contador++;
    const a: Tenant = { id: `a-${contador}` };
    const b: Tenant = { id: `b-${contador}` };
    const idDeA = `recurso-${contador}`;
    db.set(idDeA, { tenantId: a.id, secreto: `secreto-de-${a.id}` });
    return { a, b, idDeA };
  }

  async function buscarConFiltro(tenant: Tenant, id: string): Promise<Recurso | null> {
    const fila = db.get(id);
    if (!fila || fila.tenantId !== tenant.id) return null;
    return fila;
  }

  async function buscarConFiltroQueTira(tenant: Tenant, id: string): Promise<Recurso> {
    const fila = await buscarConFiltro(tenant, id);
    if (!fila) throw new ErrorNoEncontrado();
    return fila;
  }

  /** El bug: ignora `tenant` y devuelve la fila de CUALQUIER dueño. */
  async function buscarSinFiltro(_tenant: Tenant, id: string): Promise<Recurso | null> {
    return db.get(id) ?? null;
  }

  return { sembrar, buscarConFiltro, buscarConFiltroQueTira, buscarSinFiltro };
}

const esNoEncontrado = (r: unknown): boolean => r === null || r instanceof ErrorNoEncontrado;

describe('probarAislamiento', () => {
  it('reporta ok en los casos que filtran por tenant (devolviendo null o tirando)', async () => {
    const { sembrar, buscarConFiltro, buscarConFiltroQueTira } = crearEscenario();
    const casos: CasoAislamiento<Tenant>[] = [
      { nombre: 'buscarConFiltro', ejecutar: ({ tenant, idAjeno }) => buscarConFiltro(tenant, idAjeno) },
      { nombre: 'buscarConFiltroQueTira', ejecutar: ({ tenant, idAjeno }) => buscarConFiltroQueTira(tenant, idAjeno) },
    ];

    const resultados = await probarAislamiento({ casos, sembrar, esNoEncontrado });

    expect(resultados).toEqual([
      { nombre: 'buscarConFiltro', ok: true, detalle: expect.any(String) },
      { nombre: 'buscarConFiltroQueTira', ok: true, detalle: expect.any(String) },
    ]);
  });

  it('reporta la fuga: el caso que no filtra por tenant queda con ok: false', async () => {
    const { sembrar, buscarConFiltro, buscarSinFiltro } = crearEscenario();
    const casos: CasoAislamiento<Tenant>[] = [
      { nombre: 'buscarConFiltro (sano)', ejecutar: ({ tenant, idAjeno }) => buscarConFiltro(tenant, idAjeno) },
      { nombre: 'buscarSinFiltro (con fuga)', ejecutar: ({ tenant, idAjeno }) => buscarSinFiltro(tenant, idAjeno) },
    ];

    const resultados = await probarAislamiento({ casos, sembrar, esNoEncontrado });

    expect(resultados.find((r) => r.nombre === 'buscarConFiltro (sano)')?.ok).toBe(true);

    const fuga = resultados.find((r) => r.nombre === 'buscarSinFiltro (con fuga)');
    expect(fuga?.ok).toBe(false);
    expect(fuga?.detalle).toContain('secreto-de-a-');
  });

  it('llama a sembrar() una vez por caso, con aislamiento entre casos', async () => {
    const { sembrar, buscarConFiltro } = crearEscenario();
    const sembrarEspiado = vi.fn(sembrar);
    const casos: CasoAislamiento<Tenant>[] = [
      { nombre: 'uno', ejecutar: ({ tenant, idAjeno }) => buscarConFiltro(tenant, idAjeno) },
      { nombre: 'dos', ejecutar: ({ tenant, idAjeno }) => buscarConFiltro(tenant, idAjeno) },
      { nombre: 'tres', ejecutar: ({ tenant, idAjeno }) => buscarConFiltro(tenant, idAjeno) },
    ];

    await probarAislamiento({ casos, sembrar: sembrarEspiado, esNoEncontrado });

    expect(sembrarEspiado).toHaveBeenCalledTimes(3);
  });

  it('exige al menos un caso', async () => {
    await expect(
      probarAislamiento({ casos: [], sembrar: crearEscenario().sembrar, esNoEncontrado }),
    ).rejects.toThrow(/al menos un caso/);
  });

  it('reporta la fuga cuando ejecutar() TIRA algo que no clasifica como "no encontrado"', async () => {
    const { sembrar } = crearEscenario();
    const casos: CasoAislamiento<Tenant>[] = [
      {
        nombre: 'tira un error inesperado',
        ejecutar: async () => {
          throw new Error('la consulta explotó, no es un 404');
        },
      },
    ];

    const resultados = await probarAislamiento({ casos, sembrar, esNoEncontrado });

    expect(resultados[0]!.ok).toBe(false);
    expect(resultados[0]!.detalle).toContain('la consulta explotó');
  });

  it('describe una fuga aunque el resultado no sea serializable con JSON.stringify (ej. BigInt)', async () => {
    const casos: CasoAislamiento<Tenant>[] = [{ nombre: 'fuga con bigint', ejecutar: async () => 10n }];
    const resultados = await probarAislamiento({ casos, sembrar: crearEscenario().sembrar, esNoEncontrado });
    expect(resultados[0]!.ok).toBe(false);
    expect(resultados[0]!.detalle).toContain('10');
  });

  it('propaga si sembrar() tira (fixture de la app rota, no un hallazgo de aislamiento)', async () => {
    const sembrarQueTira = async (): Promise<{ a: Tenant; b: Tenant; idDeA: string }> => {
      throw new Error('no se pudo levantar el fixture');
    };
    await expect(
      probarAislamiento({
        casos: [{ nombre: 'x', ejecutar: async () => null }],
        sembrar: sembrarQueTira,
        esNoEncontrado,
      }),
    ).rejects.toThrow('no se pudo levantar el fixture');
  });
});
