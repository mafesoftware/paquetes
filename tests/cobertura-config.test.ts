import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import config, { umbralesDeCoberturaPorPaquete } from '../vitest.config.js';
import { coincideAlguno } from './lib/glob-simple.js';

/**
 * Prueba local (Ruling de revisión de P.1, y fix round 1 de la revisión de
 * P.2: "el umbral tiene que ser por paquete, no un agregado del monorepo")
 * de que `test.coverage` en vitest.config.ts apunta a los globs correctos:
 * núcleo puro de cada paquete (`packages/*\/src/**`), excluyendo `/drizzle`,
 * `/next`, `/pruebas` y los propios tests; y de que el umbral de 95% se
 * genera **por paquete** (una clave de glob por cada `packages/<nombre>`),
 * no como un único umbral global que un paquete flojo podría esconder
 * detrás de uno con mucha cobertura. No depende de que existan paquetes
 * reales en `packages/*` (hoy no hay ninguno): el CI corre igual con
 * cobertura habilitada y no falla contra un universo vacío (ver `bun run
 * test -- --coverage`, que reporta "0/0" y sale con éxito).
 */
const coverage = config.test?.coverage;
if (!coverage || typeof coverage !== 'object' || !('include' in coverage)) {
  throw new Error('vitest.config.ts no tiene test.coverage.include configurado');
}
const include = coverage.include as string[];
const exclude = coverage.exclude as string[];
const thresholds = coverage.thresholds as Record<string, unknown>;

const UMBRAL_ESPERADO = { statements: 95, branches: 95, functions: 95, lines: 95 };

describe('vitest.config.ts: umbral de cobertura del núcleo (por paquete)', () => {
  it('con packages/ vacío (estado real de hoy) no genera ningún umbral', () => {
    // Sin paquetes, no hay claves de glob que agregar: v8 no tiene qué
    // chequear y el run no falla (ver bun run test -- --coverage).
    expect(thresholds).toEqual({});
  });

  it('NO define un umbral global agregado (lines/branches/functions/statements a nivel raíz)', () => {
    // Si existiera, un paquete sin tests podría quedar tapado por el
    // promedio de los demás paquetes — justo lo que este diseño evita.
    expect(thresholds).not.toHaveProperty('lines');
    expect(thresholds).not.toHaveProperty('branches');
    expect(thresholds).not.toHaveProperty('functions');
    expect(thresholds).not.toHaveProperty('statements');
  });

  it('genera un umbral de 95% por paquete, uno por cada packages/<nombre> existente', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'paquetes-cobertura-'));
    try {
      mkdirSync(join(raiz, 'paquete-a', 'src'), { recursive: true });
      mkdirSync(join(raiz, 'paquete-b', 'src'), { recursive: true });

      const generado = umbralesDeCoberturaPorPaquete(raiz);

      expect(generado).toEqual({
        'packages/paquete-a/src/**': UMBRAL_ESPERADO,
        'packages/paquete-b/src/**': UMBRAL_ESPERADO,
      });
      expect(Object.keys(generado)).toHaveLength(2);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('con packages/ inexistente, no genera ningún umbral (no debe fallar)', () => {
    expect(umbralesDeCoberturaPorPaquete(join(tmpdir(), 'no-existe-nunca-paquetes-xyz'))).toEqual({});
  });

  it('incluye el núcleo (src/**) de cualquier paquete', () => {
    const rutasDeNucleo = [
      'packages/plata-ar/src/index.ts',
      'packages/plata-ar/src/reparto.ts',
      'packages/feriados-ar/src/index.ts',
      'packages/plata-ar/src/drizzle/tablas.ts',
      'packages/plata-ar/src/next/helper.ts',
      'packages/plata-ar/src/pruebas/invariantes.ts',
    ];
    for (const ruta of rutasDeNucleo) {
      expect(coincideAlguno(include, ruta), `${ruta} debería matchear "include"`).toBe(true);
    }
  });

  it('NO incluye tooling de la raíz (scripts/ y tests/)', () => {
    const rutasFueraDeAlcance = [
      'scripts/nuevo-paquete.ts',
      'scripts/lint-paquetes.ts',
      'tests/estructura.test.ts',
      'tests/lib/verificar-paquete.ts',
      'packages/plata-ar/tests/index.test.ts',
    ];
    for (const ruta of rutasFueraDeAlcance) {
      expect(coincideAlguno(include, ruta), `${ruta} NO debería matchear "include"`).toBe(false);
    }
  });

  it('excluye /drizzle, /next y /pruebas dentro del núcleo', () => {
    const rutasExcluidas = [
      'packages/plata-ar/src/drizzle/tablas.ts',
      'packages/plata-ar/src/drizzle/reparto.ts',
      'packages/plata-ar/src/next/helper.ts',
      'packages/plata-ar/src/pruebas/invariantes.ts',
    ];
    for (const ruta of rutasExcluidas) {
      expect(coincideAlguno(exclude, ruta), `${ruta} debería matchear "exclude"`).toBe(true);
    }
  });

  it('excluye archivos de test co-ubicados bajo src/, si algún paquete los usa', () => {
    const rutasDeTest = ['packages/plata-ar/src/reparto.test.ts', 'packages/plata-ar/src/reparto.spec.ts'];
    for (const ruta of rutasDeTest) {
      expect(coincideAlguno(exclude, ruta), `${ruta} debería matchear "exclude"`).toBe(true);
    }
  });

  it('NO excluye el núcleo real (no hay falsos positivos en "exclude")', () => {
    const rutasDeNucleoReal = ['packages/plata-ar/src/index.ts', 'packages/plata-ar/src/reparto.ts'];
    for (const ruta of rutasDeNucleoReal) {
      expect(coincideAlguno(exclude, ruta), `${ruta} NO debería matchear "exclude"`).toBe(false);
    }
  });
});
