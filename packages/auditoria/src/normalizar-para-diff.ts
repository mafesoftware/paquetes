import { claveComoTexto, clasificar, clavesPropias, intentar, llamarToJSON } from "./tipos-especiales.js";

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

function normalizar(valor: unknown, pila: Set<object>): unknown {
  if (valor === undefined) return undefined;
  if (typeof valor === "bigint") return `${valor}n`;
  if (typeof valor === "function") return "[funcion]";
  if (typeof valor === "symbol") return valor.toString();
  if (Array.isArray(valor)) {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      // `undefined` adentro de un arreglo NO se saca — mismo motivo que
      // `serializarParaAuditoria`: sacarlo correría los índices de los
      // elementos siguientes. `loQueCambio` compara arreglos como valor
      // ENTERO (no por índice), así que ni siquiera importa demasiado acá,
      // pero se mantiene la misma convención por consistencia.
      return valor.map((v) => normalizar(v, pila) ?? null);
    } finally {
      pila.delete(valor);
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
      return normalizar(llamado.valor, pila);
    } finally {
      pila.delete(valor);
    }
  }

  if (c.tipo === "map") {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      // Arreglo de pares `[clave, valor]`, igual que `redactar`/
      // `serializarParaAuditoria` — dos Maps con las MISMAS entradas (en
      // el mismo orden) normalizan al mismo arreglo, así que `loQueCambio`
      // los ve iguales.
      const pares: [string, unknown][] = [];
      for (const [clave, v] of (valor as Map<unknown, unknown>).entries()) {
        pares.push([claveComoTexto(clave), normalizar(v, pila)]);
      }
      return pares;
    } finally {
      pila.delete(valor);
    }
  }

  if (c.tipo === "set") {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      return Array.from(valor as Set<unknown>, (v) => normalizar(v, pila));
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
        resultado[clave] = "[error]";
        continue;
      }
      const normalizado = normalizar(leido.valor, pila);
      if (normalizado !== undefined) resultado[clave] = normalizado;
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
 * `Map` → arreglo de pares; `Set` → arreglo; `bigint` → string con sufijo
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
 * // [["a", "1n"]]
 * ```
 */
export function normalizarParaDiff(v: unknown): unknown {
  return normalizar(v, new Set());
}
