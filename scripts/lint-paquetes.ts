#!/usr/bin/env bun
/**
 * Corre `publint` y `@arethetypeswrong/cli` (perfil "esm-only": nuestros
 * paquetes son solo-ESM por diseño, ver tsconfig.base.json) sobre cada
 * `packages/*`. Requiere que cada paquete ya esté compilado (`bun run build`).
 *
 * Además, para cada paquete que tenga alguna dependencia `"workspace:"`
 * (hoy, `@mafesoftware/numeradores` -> `@mafesoftware/tenant`): verifica que
 * `scripts/reescribir-workspace.ts` + `bun pm pack` produzcan un
 * `package.json` empaquetado SIN ningún `"workspace:"` — la misma
 * combinación que corre `bun run release` antes de `changeset publish`. Es
 * una prueba de regresión de esa reescritura: si algún día un paquete
 * agrega un campo de dependencias que `reescribirPackageJson` no cubre (o
 * si la reescritura se rompe de otra forma), este chequeo falla ACÁ, en
 * lugar de recién al publicar de verdad y romper la instalación de todo
 * consumidor externo del paquete.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { reescribirPackageJson, versionesDeWorkspace } from './reescribir-workspace.js';

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

/**
 * Lee el package.json de `dir` y dice si tiene, en CUALQUIER lugar, el
 * texto `"workspace:"`. A propósito NO usa `reescribirPackageJson` para
 * decidir esto (sería circular: si mañana `reescribirPackageJson` deja de
 * cubrir un campo, esta función "no vería" el `"workspace:"` de ESE campo
 * tampoco, y el chequeo de abajo simplemente NO CORRERÍA para ese
 * paquete en vez de correr y fallar). Un `includes('workspace:')` sobre el
 * texto crudo detecta cualquier aparición, esté o no en un campo que la
 * reescritura sepa tocar — así el chequeo de `bun pm pack` de más abajo
 * puede de verdad atrapar una regresión de cobertura de
 * `reescribirPackageJson`.
 */
function tieneDependenciaWorkspace(dir: string): boolean {
  return readFileSync(join(dir, 'package.json'), 'utf8').includes('workspace:');
}

/**
 * Copia `dir` a un directorio descartable, aplica `reescribirPackageJson`
 * (misma función que corre `bun run release`), empaqueta con `bun pm pack`,
 * extrae el `.tgz` y devuelve `null` si el `package.json` empaquetado NO
 * tiene ningún `"workspace:"`, o un mensaje de error si sí.
 */
function verificarSinWorkspaceEnTarball(nombre: string, dir: string): string | null {
  const versiones = versionesDeWorkspace(PACKAGES);
  const scratch = mkdtempSync(join(tmpdir(), `paquetes-pack-${nombre}-`));
  const destinoTgz = mkdtempSync(join(tmpdir(), `paquetes-tgz-${nombre}-`));
  const destinoExtraido = mkdtempSync(join(tmpdir(), `paquetes-extract-${nombre}-`));
  try {
    cpSync(dir, scratch, {
      recursive: true,
      filter: (src) => !src.split(sep).includes('node_modules'),
    });

    const rutaPkg = join(scratch, 'package.json');
    const pkg = JSON.parse(readFileSync(rutaPkg, 'utf8')) as Record<string, unknown>;
    // Se aplica y escribe SIEMPRE, aunque `reescribirPackageJson` no
    // encuentre nada para cambiar — a propósito: el caller ya confirmó (con
    // `tieneDependenciaWorkspace`, que NO depende de esta función) que el
    // package.json crudo tiene `"workspace:"` en algún lado. Si acá
    // `reescribirPackageJson` no lo tocara (`cambios.length === 0`), sería
    // justo el bug que este chequeo existe para atrapar: la reescritura NO
    // cubre ese campo. Cortar temprano acá lo dejaría pasar en silencio.
    reescribirPackageJson(pkg, versiones);
    writeFileSync(rutaPkg, `${JSON.stringify(pkg, null, 2)}\n`);

    const pack = spawnSync('bun', ['pm', 'pack', '--destination', destinoTgz], { cwd: scratch, stdio: 'pipe' });
    if (pack.status !== 0) {
      return `${nombre}: "bun pm pack" falló después de reescribir workspace:\n${pack.stderr.toString()}`;
    }

    const tgz = readdirSync(destinoTgz).find((f) => f.endsWith('.tgz'));
    if (!tgz) {
      return `${nombre}: "bun pm pack" no generó ningún .tgz`;
    }

    const tar = spawnSync('tar', ['xzf', join(destinoTgz, tgz), '-C', destinoExtraido], { stdio: 'pipe' });
    if (tar.status !== 0) {
      return `${nombre}: no se pudo extraer el tarball empaquetado:\n${tar.stderr.toString()}`;
    }

    const pkgEmpaquetadoPath = join(destinoExtraido, 'package', 'package.json');
    if (!existsSync(pkgEmpaquetadoPath)) {
      return `${nombre}: el tarball empaquetado no tiene package/package.json`;
    }
    const pkgEmpaquetado = readFileSync(pkgEmpaquetadoPath, 'utf8');
    if (pkgEmpaquetado.includes('workspace:')) {
      return `${nombre}: el package.json EMPAQUETADO todavía tiene "workspace:" después de reescribir — scripts/reescribir-workspace.ts no cubre algo. Esto rompería "npm install" para cualquier consumidor real.`;
    }

    return null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(destinoTgz, { recursive: true, force: true });
    rmSync(destinoExtraido, { recursive: true, force: true });
  }
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

    if (tieneDependenciaWorkspace(dir)) {
      console.log(`--- ${nombre}: "workspace:" no debe sobrevivir a reescribir-workspace.ts + bun pm pack ---`);
      const error = verificarSinWorkspaceEnTarball(nombre, dir);
      if (error) {
        console.error(error);
        huboError = true;
      } else {
        console.log('OK');
      }
    }
  }

  if (huboError) {
    process.exit(1);
  }
}

main();
