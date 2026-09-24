#!/usr/bin/env bun
/**
 * `bun run --filter './packages/*' <script>` falla con "No packages matched
 * the filter" cuando `packages/*` está vacío (como ahora, recién creado el
 * monorepo). Este wrapper lo hace tolerante a ese caso: si no hay paquetes,
 * no hace nada (exit 0); si hay, delega en `bun run --filter`.
 *
 * Uso: bun scripts/correr-en-paquetes.ts <script>
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(RAIZ, 'packages');

function hayPaquetes(): boolean {
  if (!existsSync(PACKAGES)) {
    return false;
  }
  return readdirSync(PACKAGES).some((nombre) => statSync(join(PACKAGES, nombre)).isDirectory());
}

const script = process.argv[2];
if (!script) {
  console.error('Uso: bun scripts/correr-en-paquetes.ts <script>');
  process.exit(1);
}

if (!hayPaquetes()) {
  console.log(`No hay paquetes en packages/* todavía; nada que correr para "${script}".`);
  process.exit(0);
}

const resultado = spawnSync('bun', ['run', '--filter', './packages/*', script], {
  cwd: RAIZ,
  stdio: 'inherit',
});
process.exit(resultado.status ?? 1);
