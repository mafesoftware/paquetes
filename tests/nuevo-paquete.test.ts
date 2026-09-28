import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearPaquete, parsearArgumentosCli } from '../scripts/nuevo-paquete.js';
import { verificarPaquete } from './lib/verificar-paquete.js';

/** Crea un paquete "dependencia" mínimo bajo `raiz/packages/<nombre>`, con o sin subpath `/drizzle`, para probar `--con-dependencias`. */
function crearDependenciaDePrueba(raiz: string, nombre: string, opciones: { conDrizzle?: boolean } = {}): void {
  const dir = join(raiz, 'packages', nombre);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.ts'), 'export function algo(): string {\n  return "algo";\n}\n');
  if (opciones.conDrizzle) {
    mkdirSync(join(dir, 'src', 'drizzle'), { recursive: true });
    writeFileSync(join(dir, 'src', 'drizzle', 'index.ts'), 'export function algoDrizzle(): string {\n  return "algo-drizzle";\n}\n');
  }
}

describe('scripts/nuevo-paquete.ts', () => {
  it('genera un paquete que pasa verificarPaquete', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'paquetes-nuevo-'));
    try {
      const destino = crearPaquete('mi-paquete-de-prueba', { raiz });
      const resultado = verificarPaquete(destino);
      expect(resultado.errores).toEqual([]);
      expect(resultado.ok).toBe(true);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('rechaza nombres que no sean kebab-case en minúsculas', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'paquetes-nuevo-'));
    try {
      expect(() => crearPaquete('NoValido', { raiz })).toThrow();
      expect(() => crearPaquete('con espacios', { raiz })).toThrow();
      expect(() => crearPaquete('con_guion_bajo', { raiz })).toThrow();
      expect(() => crearPaquete('-empieza-con-guion', { raiz })).toThrow();
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('rechaza crear un paquete si la carpeta ya existe', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'paquetes-nuevo-'));
    try {
      crearPaquete('repetido', { raiz });
      expect(() => crearPaquete('repetido', { raiz })).toThrow();
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  describe('--con-dependencias (fix P.C, patrón copiado de packages/numeradores)', () => {
    it('sin dependencias, sigue generando solo tsconfig.build.json (comportamiento previo, sin cambios)', () => {
      const raiz = mkdtempSync(join(tmpdir(), 'paquetes-nuevo-'));
      try {
        const destino = crearPaquete('sin-dependencias', { raiz });
        expect(() => readFileSync(join(destino, 'tsconfig.build.json'), 'utf8')).not.toThrow();
        expect(() => readFileSync(join(destino, 'tsconfig.json'), 'utf8')).toThrow();
        expect(() => readFileSync(join(destino, 'vitest.config.ts'), 'utf8')).toThrow();
        const packageJson = JSON.parse(readFileSync(join(destino, 'package.json'), 'utf8'));
        expect(packageJson.dependencies).toBeUndefined();
      } finally {
        rmSync(raiz, { recursive: true, force: true });
      }
    });

    it('con dependencias, genera el par de tsconfig (typecheck contra fuente, build contra dist), el alias de vitest, y "dependencies" en package.json', () => {
      const raiz = mkdtempSync(join(tmpdir(), 'paquetes-nuevo-'));
      try {
        crearDependenciaDePrueba(raiz, 'una-base');
        const destino = crearPaquete('con-una-dependencia', { raiz, dependencias: ['una-base'] });

        const tsconfigJson = readFileSync(join(destino, 'tsconfig.json'), 'utf8');
        expect(tsconfigJson).toContain('../../tsconfig.base.json');
        expect(tsconfigJson).toContain('"noEmit": true');

        const tsconfigBuild = readFileSync(join(destino, 'tsconfig.build.json'), 'utf8');
        expect(tsconfigBuild).toContain('"extends": "./tsconfig.json"');
        expect(tsconfigBuild).toContain('"paths": {}');

        const vitestConfig = readFileSync(join(destino, 'vitest.config.ts'), 'utf8');
        expect(vitestConfig).toContain("'@mafesoftware/una-base'");
        expect(vitestConfig).toContain('una-base/src/index.ts');
        // Sin subpath /drizzle en la dependencia: no debe alias-ear ese subpath.
        expect(vitestConfig).not.toContain('/drizzle');

        const packageJson = JSON.parse(readFileSync(join(destino, 'package.json'), 'utf8'));
        expect(packageJson.dependencies).toEqual({ '@mafesoftware/una-base': 'workspace:*' });
        expect(packageJson.scripts.typecheck).toBe('tsc -p tsconfig.json --noEmit');

        const resultado = verificarPaquete(destino);
        expect(resultado.errores).toEqual([]);
      } finally {
        rmSync(raiz, { recursive: true, force: true });
      }
    });

    it('si la dependencia tiene subpath /drizzle, el alias de vitest también cubre ese subpath', () => {
      const raiz = mkdtempSync(join(tmpdir(), 'paquetes-nuevo-'));
      try {
        crearDependenciaDePrueba(raiz, 'con-drizzle', { conDrizzle: true });
        const destino = crearPaquete('depende-de-drizzle', { raiz, dependencias: ['con-drizzle'] });

        const vitestConfig = readFileSync(join(destino, 'vitest.config.ts'), 'utf8');
        expect(vitestConfig).toContain("'@mafesoftware/con-drizzle'");
        expect(vitestConfig).toContain("'@mafesoftware/con-drizzle/drizzle'");
        expect(vitestConfig).toContain('con-drizzle/src/drizzle/index.ts');
      } finally {
        rmSync(raiz, { recursive: true, force: true });
      }
    });

    it('con VARIAS dependencias, el alias de vitest cubre cada una', () => {
      const raiz = mkdtempSync(join(tmpdir(), 'paquetes-nuevo-'));
      try {
        crearDependenciaDePrueba(raiz, 'base-a');
        crearDependenciaDePrueba(raiz, 'base-b');
        const destino = crearPaquete('con-dos-dependencias', { raiz, dependencias: ['base-a', 'base-b'] });

        const vitestConfig = readFileSync(join(destino, 'vitest.config.ts'), 'utf8');
        expect(vitestConfig).toContain("'@mafesoftware/base-a'");
        expect(vitestConfig).toContain("'@mafesoftware/base-b'");

        const packageJson = JSON.parse(readFileSync(join(destino, 'package.json'), 'utf8'));
        expect(packageJson.dependencies).toEqual({
          '@mafesoftware/base-a': 'workspace:*',
          '@mafesoftware/base-b': 'workspace:*',
        });
      } finally {
        rmSync(raiz, { recursive: true, force: true });
      }
    });

    it('rechaza una dependencia que no existe en packages/ (typo o falta crearla antes)', () => {
      const raiz = mkdtempSync(join(tmpdir(), 'paquetes-nuevo-'));
      try {
        expect(() => crearPaquete('con-dependencia-fantasma', { raiz, dependencias: ['no-existe'] })).toThrow();
      } finally {
        rmSync(raiz, { recursive: true, force: true });
      }
    });
  });

  describe('parsearArgumentosCli', () => {
    it('un solo argumento: el nombre, sin dependencias', () => {
      expect(parsearArgumentosCli(['mi-paquete'])).toEqual({ nombre: 'mi-paquete', dependencias: [] });
    });

    it('--con-dependencias=a,b agrega las dependencias, sin espacios de más', () => {
      expect(parsearArgumentosCli(['mi-paquete', '--con-dependencias=tenant, otra-cosa'])).toEqual({
        nombre: 'mi-paquete',
        dependencias: ['tenant', 'otra-cosa'],
      });
    });

    it('el orden de los argumentos no importa', () => {
      expect(parsearArgumentosCli(['--con-dependencias=tenant', 'mi-paquete'])).toEqual({
        nombre: 'mi-paquete',
        dependencias: ['tenant'],
      });
    });

    it('sin argumentos: nombre undefined, dependencias []', () => {
      expect(parsearArgumentosCli([])).toEqual({ nombre: undefined, dependencias: [] });
    });
  });
});
