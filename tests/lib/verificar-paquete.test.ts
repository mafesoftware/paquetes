import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verificarPaquete } from './verificar-paquete.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

function ruta(nombre: string): string {
  return join(FIXTURES, nombre);
}

describe('verificarPaquete', () => {
  it('acepta un paquete bien formado, incluyendo subcarpetas drizzle/ y next/', () => {
    const resultado = verificarPaquete(ruta('paquete-bueno'));
    expect(resultado.errores).toEqual([]);
    expect(resultado.ok).toBe(true);
  });

  it('falla si el README no tiene sección "## API"', () => {
    const resultado = verificarPaquete(ruta('paquete-malo-sin-api'));
    expect(resultado.ok).toBe(false);
    expect(resultado.errores.some((e) => /API/.test(e))).toBe(true);
  });

  it('falla si falta el CHANGELOG', () => {
    const resultado = verificarPaquete(ruta('paquete-malo-sin-changelog'));
    expect(resultado.ok).toBe(false);
    expect(resultado.errores.some((e) => /CHANGELOG/.test(e))).toBe(true);
  });

  it('falla si "exports" no apunta a dist', () => {
    const resultado = verificarPaquete(ruta('paquete-malo-exports'));
    expect(resultado.ok).toBe(false);
    expect(resultado.errores.some((e) => /exports/.test(e))).toBe(true);
  });

  it('falla si falta "files" o no incluye dist', () => {
    const resultado = verificarPaquete(ruta('paquete-malo-sin-files'));
    expect(resultado.ok).toBe(false);
    expect(resultado.errores.some((e) => /files/.test(e))).toBe(true);
  });

  it('falla si la licencia no es MIT', () => {
    const resultado = verificarPaquete(ruta('paquete-malo-licencia'));
    expect(resultado.ok).toBe(false);
    expect(resultado.errores.some((e) => /licencia|MIT/i.test(e))).toBe(true);
  });

  it('falla si el núcleo importa drizzle-orm', () => {
    const resultado = verificarPaquete(ruta('paquete-malo-importa-drizzle'));
    expect(resultado.ok).toBe(false);
    expect(resultado.errores.some((e) => /drizzle-orm/.test(e))).toBe(true);
  });

  it('falla si el núcleo importa next', () => {
    const resultado = verificarPaquete(ruta('paquete-malo-importa-next'));
    expect(resultado.ok).toBe(false);
    expect(resultado.errores.some((e) => /next/.test(e))).toBe(true);
  });

  it('falla si el núcleo importa react', () => {
    const resultado = verificarPaquete(ruta('paquete-malo-importa-react'));
    expect(resultado.ok).toBe(false);
    expect(resultado.errores.some((e) => /react/.test(e))).toBe(true);
  });

  it('falla si el núcleo importa @aws-sdk', () => {
    const resultado = verificarPaquete(ruta('paquete-malo-importa-aws'));
    expect(resultado.ok).toBe(false);
    expect(resultado.errores.some((e) => /@aws-sdk/.test(e))).toBe(true);
  });

  it('falla si el núcleo usa process.env', () => {
    const resultado = verificarPaquete(ruta('paquete-malo-process-env'));
    expect(resultado.ok).toBe(false);
    expect(resultado.errores.some((e) => /process\.env/.test(e))).toBe(true);
  });
});
