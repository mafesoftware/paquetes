import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ArchivoFuente } from './tipos.js';

/**
 * **Solo Node.js**: usa `node:fs` para recorrer el disco. El resto del
 * paquete (los detectores, `correrDetectores`) es puro — trabaja sobre
 * `{ ruta; texto }[]` ya en memoria — justamente para que un consumidor con
 * otro runtime (o que arma los fixtures a mano en un test) no dependa de
 * esta función. Los tests de vitest de la app consumidora SIEMPRE corren
 * bajo Node, así que en la práctica es la forma normal de armar los
 * `archivos` que recibe `correrDetectores`.
 *
 * Recorre `raiz` recursivamente y devuelve, para cada archivo cuya ruta
 * (relativa a `raiz`, con `/` como separador) matchea alguno de `globs`, su
 * `{ ruta; texto }`. Soporta `*` (cualquier cosa dentro de un segmento) y
 * `**` (cualquier cantidad de segmentos, incluido cero) — alcanza para
 * patrones como `"src\/**\/*.ts"` o `"**\/package.json"`; no es un matcher de
 * glob de propósito general.
 */
export function leerArchivos(globs: string[], raiz: string): ArchivoFuente[] {
  const resultado: ArchivoFuente[] = [];
  const patrones = globs.map(globARegExp);

  const recorrer = (dir: string): void => {
    for (const nombre of readdirSync(dir)) {
      if (nombre === 'node_modules' || nombre === '.git') continue;
      const rutaAbsoluta = join(dir, nombre);
      const info = statSync(rutaAbsoluta);
      if (info.isDirectory()) {
        recorrer(rutaAbsoluta);
        continue;
      }
      const rutaRelativa = relative(raiz, rutaAbsoluta).split(sep).join('/');
      if (patrones.some((p) => p.test(rutaRelativa))) {
        resultado.push({ ruta: rutaRelativa, texto: readFileSync(rutaAbsoluta, 'utf8') });
      }
    }
  };

  recorrer(raiz);
  return resultado;
}

function globARegExp(glob: string): RegExp {
  let patron = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        patron += '(?:.*/)?';
        i += 3;
      } else {
        patron += '.*';
        i += 2;
      }
      continue;
    }
    if (c === '*') {
      patron += '[^/]*';
      i += 1;
      continue;
    }
    if (c && '.+^${}()|[]\\'.includes(c)) {
      patron += `\\${c}`;
      i += 1;
      continue;
    }
    patron += c;
    i += 1;
  }
  return new RegExp(`^${patron}$`);
}
