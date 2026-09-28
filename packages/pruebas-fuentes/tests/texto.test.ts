import { describe, expect, it } from 'vitest';
import { blanquear, blanquearComentarios, escaparRegex, indiceCierre, numeroDeLinea, sinEstado } from '../src/texto.js';

describe('blanquear', () => {
  it('blanquea comentarios de línea y de bloque preservando longitud y saltos de línea', () => {
    const texto = '// hola\nconst x = 1; /* bloque\nmultilinea */ const y = 2;';
    const resultado = blanquear(texto);
    expect(resultado).toHaveLength(texto.length);
    expect(resultado).not.toContain('hola');
    expect(resultado).not.toContain('bloque');
    expect(resultado.split('\n')).toHaveLength(texto.split('\n').length);
  });

  it('blanquea strings simples, dobles y template literals, respetando el escape de la comilla', () => {
    const texto = String.raw`const a = 'xx \'yy\' zz'; const b = "www"; const c = \`ttt\`;`;
    const resultado = blanquear(texto);
    expect(resultado).not.toContain('xx');
    expect(resultado).not.toContain('yy');
    expect(resultado).not.toContain('www');
    expect(resultado).not.toContain('ttt');
    expect(resultado).toContain('const a =');
  });

  it('no explota con un comentario de bloque o un string sin cerrar', () => {
    expect(() => blanquear('const x = /* sin cerrar')).not.toThrow();
    expect(() => blanquear('const x = "sin cerrar')).not.toThrow();
    expect(blanquear('const x = "sin cerrar')).toHaveLength('const x = "sin cerrar'.length);
  });
});

describe('blanquearComentarios', () => {
  it('blanquea comentarios pero deja los strings intactos', () => {
    const texto = '// nota\nimport { x } from "@/lib/datos";';
    const resultado = blanquearComentarios(texto);
    expect(resultado).not.toContain('nota');
    expect(resultado).toContain('"@/lib/datos"');
  });

  it('no confunde un "//" dentro de un string con un comentario', () => {
    const texto = 'const url = "https://ejemplo.com";';
    expect(blanquearComentarios(texto)).toContain('https://ejemplo.com');
  });

  it('no explota con un comentario de bloque o un string sin cerrar', () => {
    expect(() => blanquearComentarios('const x = /* sin cerrar')).not.toThrow();
    expect(() => blanquearComentarios('const x = "sin cerrar')).not.toThrow();
  });
});

describe('numeroDeLinea', () => {
  it('cuenta saltos de línea hasta el índice', () => {
    const texto = 'a\nb\nc';
    expect(numeroDeLinea(texto, 0)).toBe(1);
    expect(numeroDeLinea(texto, 2)).toBe(2);
    expect(numeroDeLinea(texto, 4)).toBe(3);
  });

  it('no se pasa del final del texto', () => {
    expect(numeroDeLinea('a\nb', 1000)).toBe(2);
  });
});

describe('indiceCierre', () => {
  it('encuentra el cierre balanceado, aunque haya anidamiento', () => {
    const texto = '(a (b) c)';
    expect(indiceCierre(texto, 0, '(', ')')).toBe(8);
  });

  it('devuelve -1 si no hay cierre', () => {
    expect(indiceCierre('(a (b) c', 0, '(', ')')).toBe(-1);
  });
});

describe('escaparRegex', () => {
  it('escapa los caracteres especiales de regex', () => {
    const regex = new RegExp(escaparRegex('a.b*c?'));
    expect(regex.test('a.b*c?')).toBe(true);
    expect(regex.test('axbyc')).toBe(false);
  });
});

describe('sinEstado', () => {
  it('quita las flags g/y para que .test() no arrastre lastIndex', () => {
    const conG = /a/g;
    const sinG = sinEstado(conG);
    expect(sinG.flags).toBe('');
    expect(sinG.test('a')).toBe(true);
    expect(sinG.test('a')).toBe(true); // sin lastIndex, siempre da lo mismo
  });
});
