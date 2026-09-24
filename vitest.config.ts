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
      reporter: ['text', 'html'],
    },
  },
});
