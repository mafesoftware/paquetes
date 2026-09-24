import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const RAIZ = fileURLToPath(new URL('.', import.meta.url));
const PACKAGES = join(RAIZ, 'packages');

/** Umbral de cobertura (v8/istanbul) en las cuatro métricas que exige spec 06 §3. */
export interface UmbralCobertura {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

/** Directorios de `packages/<nombre>` existentes bajo `dirPackages` (mismo criterio que scripts/lint-paquetes.ts). */
export function nombresDePaquetes(dirPackages: string): string[] {
  if (!existsSync(dirPackages)) {
    return [];
  }
  return readdirSync(dirPackages).filter((nombre) => statSync(join(dirPackages, nombre)).isDirectory());
}

/**
 * Genera un umbral de cobertura **por paquete** (uno por cada `packages/<nombre>`
 * existente), no uno global agregado del monorepo entero. Esto es a propósito:
 * un umbral global promedia todos los paquetes juntos, así que un paquete
 * flojo puede quedar tapado por uno con mucha cobertura y el gate no lo
 * detecta. Vitest resuelve cada clave de `coverage.thresholds` que no sea
 * `perFile`/`autoUpdate`/`100`/una de las cuatro métricas como un **glob**
 * con su propio grupo de cobertura (ver
 * node_modules/vitest/dist/chunks/index.*.js → `resolveThresholds`): agrega
 * solo los archivos que matchean ese glob y chequea el umbral contra ESE
 * grupo, no contra el total del repo. Deliberadamente NO se agrega un umbral
 * global (`lines`/`branches`/`functions`/`statements` a nivel raíz de
 * `thresholds`) junto a estos: si lo hubiera, un paquete sin cobertura
 * seguiría sin hacer fallar el chequeo global mientras el agregado del resto
 * del repo compense — que es exactamente el problema que este diseño evita.
 *
 * Con `packages/` vacío (monorepo recién creado, sin paquetes todavía) esto
 * devuelve `{}`: sin claves de glob que resolver, v8 no tiene qué chequear y
 * no falla (ver tests/cobertura-config.test.ts, que también lo prueba contra
 * dos paquetes de fixture).
 */
export function umbralesDeCoberturaPorPaquete(dirPackages: string, umbral = 95): Record<string, UmbralCobertura> {
  const resultado: Record<string, UmbralCobertura> = {};
  for (const nombre of nombresDePaquetes(dirPackages)) {
    resultado[`packages/${nombre}/src/**`] = {
      statements: umbral,
      branches: umbral,
      functions: umbral,
      lines: umbral,
    };
  }
  return resultado;
}

// Nota: vitest 5 eliminó `vitest.workspace.ts` / `defineWorkspace` (ver README,
// sección "Tooling"). El equivalente actual es `test.projects` en un único
// vitest.config.ts: un proyecto para los tests de la raíz (tooling) y un glob
// para que cada `packages/*` corra los suyos con su propia config si la tiene.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'raiz',
          root: '.',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/fixtures/**', 'node_modules/**', 'packages/**'],
        },
      },
      'packages/*',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // Cobertura del núcleo de cada paquete (spec 06 §3 / restricciones.md:
      // "cobertura ≥ 95% del núcleo"). Deliberadamente NO se mide contra
      // scripts/ ni tests/ de la raíz (herramienta del monorepo, no producto
      // publicado). Si `packages/*/src` no existe todavía (monorepo recién
      // creado, sin paquetes), este glob no matchea nada y v8 reporta 0
      // archivos sin hacer fallar los umbrales (ver
      // tests/cobertura-config.test.ts, que lo prueba con un matcher de
      // globs propio, sin dependencias).
      include: ['packages/*/src/**'],
      exclude: [
        // Subpaths opcionales con dependencias de framework/DB inyectadas
        // (Drizzle, Next) — no son "núcleo puro" y spec 06 §3 no les exige
        // 95% (sus propios paquetes deciden si testearlos).
        'packages/*/src/drizzle/**',
        'packages/*/src/next/**',
        // Invariantes/fixtures exportadas para que las use CADA APP, no
        // lógica propia del paquete.
        'packages/*/src/pruebas/**',
        // Los propios tests, si algún paquete los co-ubica bajo src/.
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/*.spec.ts',
      ],
      // Umbral **por paquete** (ver `umbralesDeCoberturaPorPaquete` arriba),
      // no un agregado global del monorepo.
      thresholds: umbralesDeCoberturaPorPaquete(PACKAGES),
    },
  },
});
