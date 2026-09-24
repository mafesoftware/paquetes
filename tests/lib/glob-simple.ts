/**
 * Matcher de globs mínimo (sin dependencias) para validar en tests que los
 * patrones `include`/`exclude` de `vitest.config.ts` → `test.coverage`
 * apuntan a las rutas correctas. Soporta `*` (cualquier cosa dentro de un
 * segmento) y `**` (cualquier cantidad de segmentos, incluido cero), que es
 * todo lo que usan esos patrones. No es de propósito general: alcanza para
 * este test, evitando depender de `picomatch` (dependencia transitiva no
 * declarada) solo para esta verificación.
 */
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

export function coincide(glob: string, ruta: string): boolean {
  return globARegExp(glob).test(ruta);
}

export function coincideAlguno(globs: readonly string[], ruta: string): boolean {
  return globs.some((glob) => coincide(glob, ruta));
}
