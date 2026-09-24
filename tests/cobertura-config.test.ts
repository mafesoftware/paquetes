import { describe, expect, it } from 'vitest';
import config from '../vitest.config.js';
import { coincideAlguno } from './lib/glob-simple.js';

/**
 * Prueba local (Ruling de revisión de P.1: "wire the coverage gate here")
 * de que `test.coverage` en vitest.config.ts apunta a los globs correctos:
 * núcleo puro de cada paquete (`packages/*\/src/**`), excluyendo
 * `/drizzle`, `/next`, `/pruebas` y los propios tests, con umbral 95% en
 * las cuatro métricas. No depende de que existan paquetes reales en
 * `packages/*` (hoy no hay ninguno): el CI corre igual con cobertura
 * habilitada y no falla contra un universo vacío (ver `bun run test --
 * --coverage`, que reporta "0/0" y sale con éxito).
 */
const coverage = config.test?.coverage;
if (!coverage || typeof coverage !== 'object' || !('include' in coverage)) {
  throw new Error('vitest.config.ts no tiene test.coverage.include configurado');
}
const include = coverage.include as string[];
const exclude = coverage.exclude as string[];
const thresholds = coverage.thresholds as Record<string, number>;

describe('vitest.config.ts: umbral de cobertura del núcleo', () => {
  it('exige 95% en las cuatro métricas', () => {
    expect(thresholds).toEqual({
      lines: 95,
      branches: 95,
      functions: 95,
      statements: 95,
    });
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
