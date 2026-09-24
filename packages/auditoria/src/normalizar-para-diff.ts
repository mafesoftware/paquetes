import { clasificar, clavesPropias, definirPropiedad, elementosDeSet, entradasDeMap, esArreglo, excedeProfundidad, intentar, llamarToJSON, TEXTO_PROFUNDIDAD } from "./tipos-especiales.js";

/**
 * Lee `objeto[clave]`, atrapando una excepción si `clave` es un getter que
 * tira. Devuelve `{ ok: true, valor }` o `{ ok: false }`.
 */
function leerPropiedad(objeto: Record<string, unknown>, clave: string): { ok: true; valor: unknown } | { ok: false } {
  try {
    return { ok: true, valor: objeto[clave] };
  } catch {
    return { ok: false };
  }
}

function normalizar(valor: unknown, pila: Set<object>, profundidad: number): unknown {
  if (valor === undefined) return undefined;
  if (typeof valor === "bigint") return `${valor}n`;
  if (typeof valor === "function") return "[funcion]";
  if (typeof valor === "symbol") return valor.toString();
  // P1 (P.10b, ronda de fix 3): tope de profundidad — ver PROFUNDIDAD_MAXIMA.
  if (excedeProfundidad(valor, profundidad)) return TEXTO_PROFUNDIDAD;
  // P5: `Array.isArray` tira con un Proxy revocado.
  const arreglo = esArreglo(valor);
  if (arreglo === "error") return "[error]";
  if (arreglo) {
    const lista = valor as unknown[];
    if (pila.has(lista)) return "[ciclo]";
    pila.add(lista);
    try {
      // `undefined` adentro de un arreglo NO se saca — mismo motivo que
      // `serializarParaAuditoria`: sacarlo correría los índices de los
      // elementos siguientes. `loQueCambio` compara arreglos como valor
      // ENTERO (no por índice), así que ni siquiera importa demasiado acá,
      // pero se mantiene la misma convención por consistencia.
      return lista.map((v) => normalizar(v, pila, profundidad + 1) ?? null);
    } finally {
      pila.delete(lista);
    }
  }
  if (typeof valor !== "object" || valor === null) {
    // string, number, boolean, null: se devuelven tal cual.
    return valor;
  }

  // `clasificar` (ver tipos-especiales.ts): binario/Date/RegExp/URL/Error/
  // toJSON/Map/Set, en ese orden — INCLUIDO un `toJSON` propio en un
  // objeto PLANO (`{ dni: "...", toJSON() { ... } }`), no solo en
  // instancias de clase: sin esto, `loQueCambio` recorrería ese objeto por
  // sus claves propias (`dni` Y `toJSON`, la FUNCIÓN), y dos closures de
  // `toJSON` nunca son `===` entre sí — un falso "cambio" en el campo
  // "toJSON" en cada diff, aunque el valor real (el que da `toJSON()`) sea
  // idéntico. Envuelta en `intentar`: ver el JSDoc de `clasificar`.
  const clasificacion = intentar(() => clasificar(valor));
  if (!clasificacion.ok) return "[error]";
  const c = clasificacion.valor;

  if (c.tipo === "resuelto") return c.valor;

  if (c.tipo === "toJSON") {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      const llamado = llamarToJSON(valor as { toJSON: () => unknown });
      if (!llamado.ok) return "[error]";
      return normalizar(llamado.valor, pila, profundidad + 1);
    } finally {
      pila.delete(valor);
    }
  }

  if (c.tipo === "map") {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      // Ronda 5: un OBJETO plano con la clave como texto (desambiguada con
      // " (2)", " (3)"… si dos claves dan el mismo texto — ver
      // `entradasDeMap`), NO un arreglo de pares. Con pares, `loQueCambio`
      // veía el Map como una HOJA (un arreglo) y la ruta del cambio se
      // cortaba en el Map (`"m"`): una clave sensible del Map
      // (`"password"`) nunca llegaba a ser un segmento de la ruta, y la
      // redacción por ruta de `redactarCambios` no la tapaba (C1). Como
      // objeto, `loQueCambio` baja a sus claves (`"m.password"`). Una
      // iteración que tira deja el nodo en "[error]" (M2). `undefined` se
      // descarta, igual que en un objeto.
      const leidas = entradasDeMap(valor as Map<unknown, unknown>);
      if (!leidas.ok) return "[error]";
      const resultado: Record<string, unknown> = {};
      for (const { clave, valor: v } of leidas.entradas) {
        const normalizado = normalizar(v, pila, profundidad + 1);
        if (normalizado !== undefined) definirPropiedad(resultado, clave, normalizado);
      }
      return resultado;
    } finally {
      pila.delete(valor);
    }
  }

  if (c.tipo === "set") {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      const leidos = elementosDeSet(valor as Set<unknown>);
      if (!leidos.ok) return "[error]";
      return leidos.elementos.map((v) => normalizar(v, pila, profundidad + 1) ?? null);
    } finally {
      pila.delete(valor);
    }
  }

  // c.tipo === "objeto": objeto plano SIN toJSON propio, o instancia de
  // una clase propia — se recorre por sus claves propias ENUMERABLES,
  // igual que `redactar`/`serializarParaAuditoria`. `undefined` se
  // DESCARTA (una clave con valor `undefined` desaparece): consistente con
  // que `loQueCambio` ya trata "ausente" y "undefined explícito" como lo
  // mismo (ver su JSDoc, M11).
  if (pila.has(valor)) return "[ciclo]";
  pila.add(valor);
  try {
    const objeto = valor as Record<string, unknown>;
    const clavesLeidas = clavesPropias(objeto);
    if (!clavesLeidas.ok) return "[error]";
    const resultado: Record<string, unknown> = {};
    for (const clave of clavesLeidas.claves) {
      const leido = leerPropiedad(objeto, clave);
      if (!leido.ok) {
        definirPropiedad(resultado, clave, "[error]");
        continue;
      }
      const normalizado = normalizar(leido.valor, pila, profundidad + 1);
      if (normalizado !== undefined) definirPropiedad(resultado, clave, normalizado);
    }
    return resultado;
  } finally {
    pila.delete(valor);
  }
}

/**
 * Convierte `v` a datos planos, JSON-como, con las MISMAS reglas de tipos
 * especiales que `serializarParaAuditoria` (binario → `"[binario N
 * bytes]"`, `Date` → ISO, `RegExp` → `String(re)`, `URL` → `origin` +
 * `pathname`, `Error` → `{ name }`, cualquier objeto — PLANO o instancia de
 * clase — con un `toJSON` propio → su resultado, recursivamente normalizado;
 * `Map` → OBJETO plano con la clave como texto (colisiones desambiguadas
 * con `" (2)"`, `" (3)"`…, en orden de inserción); `Set` → arreglo;
 * `bigint` → string con sufijo
 * `"n"`), pero **sin redactar nada** — a diferencia de `redactar`, esta
 * función no mira nombres de clave ni tapa ningún valor. `undefined`/`null`
 * pasan tal cual en cualquier posición (incluida la raíz), para no romper
 * el manejo de "lado ausente" de `loQueCambio`. Nunca tira: los mismos
 * casos "[ciclo]"/"[error]" que `redactar`/`serializarParaAuditoria`.
 *
 * **Para qué existe**: `auditar` (`/drizzle`) la usa para normalizar
 * `antes`/`despues` ANTES de pasarlos a `loQueCambio`. Sin esto,
 * `loQueCambio` comparaba los valores CRUDOS — y dos instancias DISTINTAS
 * con el MISMO valor semántico (dos `Decimal("12.50")` separados, dos
 * `Map`s con las mismas entradas, dos `URL` para la misma dirección, dos
 * instancias de una misma clase con los mismos campos) nunca son `===`
 * entre sí, así que `loQueCambio` las reportaba como "cambiadas" aunque el
 * valor real fuera idéntico — un falso positivo en `cambios`. Normalizando
 * los dos lados PRIMERO, `loQueCambio` compara datos planos donde la
 * igualdad estructural (por campo, o por valor completo en el caso de
 * arreglos) sí funciona como se espera.
 *
 * ```ts
 * import { normalizarParaDiff } from "@mafesoftware/auditoria";
 * import { loQueCambio } from "@mafesoftware/auditoria";
 *
 * class Decimal { constructor(private texto: string) {} toJSON() { return this.texto; } }
 * loQueCambio(new Decimal("12.50"), new Decimal("12.50"));
 * // [{ campo: "(raiz)", antes: Decimal{...}, despues: Decimal{...} }] (SIN normalizar: instancias distintas, "cambiaron")
 * loQueCambio(normalizarParaDiff(new Decimal("12.50")), normalizarParaDiff(new Decimal("12.50")));
 * // [] (normalizadas, las dos dan "12.50": iguales)
 *
 * normalizarParaDiff(new Map([["a", 1n]]));
 * // { a: "1n" }
 *
 * normalizarParaDiff(new Map<unknown, string>([[1, "x"], ["1", "y"]]));
 * // { "1": "x", "1 (2)": "y" } (dos claves con el mismo texto: la segunda con sufijo)
 * ```
 *
 * **Nunca guardes ni loguees el resultado de esta función** (ni el de
 * `loQueCambio` sobre él): no redacta nada, así que una contraseña, un
 * token o un CBU salen tal cual. Es solo un paso intermedio para diffear;
 * lo que se guarda es `redactarCambios(loQueCambio(...))` y
 * `serializarParaAuditoria(redactar(...))` de las fotos originales.
  *
 * Corta en `PROFUNDIDAD_MAXIMA` (500) igual que `redactar`: un contenedor
 * más hondo queda `"[profundidad]"`. Un `Proxy` revocado queda `"[error]"`.
 */
export function normalizarParaDiff(v: unknown): unknown {
  return normalizar(v, new Set(), 0);
}
