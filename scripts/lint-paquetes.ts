#!/usr/bin/env bun
/**
 * Corre `publint` y `@arethetypeswrong/cli` (perfil "esm-only": nuestros
 * paquetes son solo-ESM por diseño, ver tsconfig.base.json) sobre cada
 * `packages/*`. Requiere que cada paquete ya esté compilado (`bun run build`).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(RAIZ, 'packages');

function paquetes(): string[] {
  if (!existsSync(PACKAGES)) {
    return [];
  }
  return readdirSync(PACKAGES).filter((nombre) => statSync(join(PACKAGES, nombre)).isDirectory());
}

function correr(cmd: string, args: string[], cwd: string): boolean {
  const resultado = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  return resultado.status === 0;
}

function main(): void {
  const nombres = paquetes();
  if (nombres.length === 0) {
    console.log('No hay paquetes en packages/* todavía; nada que lintear.');
    return;
  }

  let huboError = false;
  for (const nombre of nombres) {
    const dir = join(PACKAGES, nombre);
    console.log(`\n--- ${nombre}: publint ---`);
    const publintOk = correr('bunx', ['publint', '.'], dir);
    console.log(`--- ${nombre}: attw --pack (perfil esm-only) ---`);
    const attwOk = correr('bunx', ['attw', '--pack', '.', '--profile', 'esm-only'], dir);
    if (!publintOk || !attwOk) {
      huboError = true;
    }
  }

  if (huboError) {
    process.exit(1);
  }
}

main();
