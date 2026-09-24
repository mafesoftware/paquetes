import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * `cuotas` depende de `@mafesoftware/plata-ar` y `@mafesoftware/fechas-ar`
 * dentro del mismo monorepo (`workspace:*`). El `package.json` de esos
 * paquetes expone `exports` apuntando a `dist/` (lo que exige
 * tests/lib/verificar-paquete.ts para el paquete YA COMPILADO), pero
 * `bun run test` corre ANTES que `bun run build` (ver .github/workflows/ci.yml
 * y README "CI"), así que ese `dist/` todavía no existe.
 *
 * Este alias resuelve la dependencia directo a su fuente para los tests
 * dentro del monorepo, sin tocar el `package.json` publicado (que sigue
 * apuntando a `dist/` para quien lo instale desde npm). El equivalente para
 * `tsc` es el `paths` de `tsconfig.base.json`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@mafesoftware/plata-ar': fileURLToPath(new URL('../plata-ar/src/index.ts', import.meta.url)),
      '@mafesoftware/fechas-ar': fileURLToPath(new URL('../fechas-ar/src/index.ts', import.meta.url)),
    },
  },
});
