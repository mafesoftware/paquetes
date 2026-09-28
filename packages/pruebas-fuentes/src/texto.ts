/**
 * Utilidades de texto compartidas por los detectores.
 *
 * Son heurísticas por regex/tokens, NO un parser de TypeScript: alcanzan para
 * el código de aplicación razonablemente formateado que escriben los
 * productos de MAFE Software, y documentan a propósito dónde pueden fallar
 * (ver el "## Política de falsos positivos/negativos" del README). Si hiciera
 * falta precisión de parser, el TypeScript Compiler API sería la herramienta
 * correcta — pero eso obligaría a cada app consumidora a cargarlo como
 * dependencia pesada solo para correr estos tests, así que se evita.
 */

/**
 * Reemplaza comentarios (`//...`, `/* ... *\/`) y literales de cadena
 * (`'...'`, `"..."`, `` `...` ``) por espacios, preservando la longitud y los
 * saltos de línea del texto original. Así los detectores pueden aplicar sus
 * regex "como si" comentarios y strings no existieran, sin perder los índices
 * de carácter (que siguen apuntando al texto ORIGINAL) ni los números de
 * línea.
 *
 * Límite conocido: un template literal con una expresión `${...}` anidada
 * que a su vez contenga backticks (template literals dentro de
 * interpolaciones) no se seguye correctamente — se trata el backtick interno
 * como cierre. Es un caso raro en código de aplicación; si aparece, puede dar
 * un falso negativo (el contenido después queda sin blanquear) o un falso
 * positivo aislado. Ver README.
 */
export function blanquear(texto: string): string {
  let resultado = '';
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const dos = texto.slice(i, i + 2);
    if (dos === '//') {
      let j = i;
      while (j < n && texto[j] !== '\n') j++;
      resultado += ' '.repeat(j - i);
      i = j;
      continue;
    }
    if (dos === '/*') {
      let j = i + 2;
      while (j < n - 1 && texto.slice(j, j + 2) !== '*/') j++;
      j = Math.min(j + 2, n);
      resultado += texto.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }
    const c = texto[i];
    if (c === '"' || c === "'" || c === '`') {
      const comilla = c;
      let j = i + 1;
      while (j < n && texto[j] !== comilla) {
        if (texto[j] === '\\') j++;
        j++;
      }
      j = Math.min(j + 1, n);
      resultado += texto.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }
    resultado += c;
    i++;
  }
  return resultado;
}

/**
 * Igual que `blanquear`, pero deja los literales de cadena INTACTOS — solo
 * blanquea comentarios. Para detectores que necesitan mirar el contenido de
 * un string (ej. el especificador de un `import ... from "..."`), donde
 * `blanquear` se lo comería.
 */
export function blanquearComentarios(texto: string): string {
  let resultado = '';
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const dos = texto.slice(i, i + 2);
    if (dos === '//') {
      let j = i;
      while (j < n && texto[j] !== '\n') j++;
      resultado += ' '.repeat(j - i);
      i = j;
      continue;
    }
    if (dos === '/*') {
      let j = i + 2;
      while (j < n - 1 && texto.slice(j, j + 2) !== '*/') j++;
      j = Math.min(j + 2, n);
      resultado += texto.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
      continue;
    }
    const c = texto[i];
    if (c === '"' || c === "'" || c === '`') {
      const comilla = c;
      let j = i + 1;
      while (j < n && texto[j] !== comilla) {
        if (texto[j] === '\\') j++;
        j++;
      }
      j = Math.min(j + 1, n);
      resultado += texto.slice(i, j);
      i = j;
      continue;
    }
    resultado += c;
    i++;
  }
  return resultado;
}

/** Número de línea (1-based) del carácter en `indice`. */
export function numeroDeLinea(texto: string, indice: number): number {
  let n = 1;
  const hasta = Math.min(indice, texto.length);
  for (let i = 0; i < hasta; i++) {
    if (texto[i] === '\n') n++;
  }
  return n;
}

/**
 * Índice del carácter `cierra` que balancea el `abre` que está en
 * `indiceApertura` (que debe contener ese carácter), contando anidamiento.
 * Se usa siempre sobre texto YA blanqueado (`blanquear`), para que un
 * `{`/`(` dentro de un string o un comentario no descuadre el conteo.
 * Devuelve -1 si no hay cierre balanceado.
 */
export function indiceCierre(textoBlanqueado: string, indiceApertura: number, abre: string, cierra: string): number {
  let nivel = 0;
  for (let i = indiceApertura; i < textoBlanqueado.length; i++) {
    const c = textoBlanqueado[i];
    if (c === abre) nivel++;
    else if (c === cierra) {
      nivel--;
      if (nivel === 0) return i;
    }
  }
  return -1;
}

/** Escapa un string para usarlo literal dentro de un `RegExp`. */
export function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Copia de un RegExp sin la flag `g`/`y`, para poder usar `.test()` en un loop sin estado de `lastIndex`. */
export function sinEstado(regex: RegExp): RegExp {
  return new RegExp(regex.source, regex.flags.replace(/[gy]/g, ''));
}
