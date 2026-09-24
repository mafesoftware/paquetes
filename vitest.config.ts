import { defineConfig } from 'vitest/config';

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
      // tests/cobertura-config.test.ts, que lo prueba con picomatch).
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
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
});
