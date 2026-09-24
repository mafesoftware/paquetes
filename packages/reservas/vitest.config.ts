import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `reservas` depende de `@mafesoftware/fechas-ar` y `@mafesoftware/plata-ar`
 * dentro del mismo monorepo. Ver el comentario en
 * `packages/cuotas/vitest.config.ts`: este alias resuelve esas dependencias
 * a su fuente para los tests (que corren antes que `bun run build`), sin
 * tocar el `package.json` publicado.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@mafesoftware/fechas-ar': fileURLToPath(new URL('../fechas-ar/src/index.ts', import.meta.url)),
      '@mafesoftware/plata-ar': fileURLToPath(new URL('../plata-ar/src/index.ts', import.meta.url)),
    },
  },
});
