import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leerArchivos } from '../src/index.js';

describe('leerArchivos', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('lee, recursivamente, los archivos que matchean los globs', () => {
    dir = mkdtempSync(join(tmpdir(), 'pruebas-fuentes-'));
    mkdirSync(join(dir, 'src', 'lib'), { recursive: true });
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 1;');
    writeFileSync(join(dir, 'src', 'lib', 'datos.ts'), 'export const b = 2;');
    writeFileSync(join(dir, 'src', 'lib', 'estilos.css'), 'body {}');
    writeFileSync(join(dir, 'package.json'), '{}');

    const archivos = leerArchivos(['src/**/*.ts'], dir);
    const rutas = archivos.map((a) => a.ruta).sort();
    expect(rutas).toEqual(['src/index.ts', 'src/lib/datos.ts']);
    expect(archivos.find((a) => a.ruta === 'src/lib/datos.ts')?.texto).toBe('export const b = 2;');
  });

  it('soporta varios globs y no repite node_modules/.git', () => {
    dir = mkdtempSync(join(tmpdir(), 'pruebas-fuentes-'));
    mkdirSync(join(dir, 'node_modules', 'algo'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'algo', 'index.ts'), 'ruido');
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'README.md'), '# hola');

    const archivos = leerArchivos(['**/package.json', '*.md'], dir);
    const rutas = archivos.map((a) => a.ruta).sort();
    expect(rutas).toEqual(['README.md', 'package.json']);
  });

  it('sin matches, devuelve vacío', () => {
    dir = mkdtempSync(join(tmpdir(), 'pruebas-fuentes-'));
    writeFileSync(join(dir, 'a.txt'), 'x');
    expect(leerArchivos(['*.ts'], dir)).toEqual([]);
  });

  it('soporta "**" no seguido de "/" (ej. "**.ts")', () => {
    dir = mkdtempSync(join(tmpdir(), 'pruebas-fuentes-'));
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'a.ts'), 'x');
    writeFileSync(join(dir, 'src', 'b.ts'), 'y');
    const archivos = leerArchivos(['**.ts'], dir);
    expect(archivos.map((a) => a.ruta).sort()).toEqual(['a.ts', 'src/b.ts']);
  });
});
