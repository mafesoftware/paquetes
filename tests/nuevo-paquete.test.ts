import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearPaquete } from '../scripts/nuevo-paquete.js';
import { verificarPaquete } from './lib/verificar-paquete.js';

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
});
