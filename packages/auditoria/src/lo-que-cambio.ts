/** Un campo que cambió entre `antes` y `despues`. */
export interface CambioAuditoria {
  /** La ruta con puntos hasta el campo (ej. `"direccion.calle"`), o `"(raiz)"` si `antes`/`despues` no son objetos. */
  campo: string;
  antes: unknown;
  despues: unknown;
}

/** Un objeto "plano": no `null`, no arreglo, no `Date`, y con el prototipo de `Object` (o sin prototipo) — nunca una instancia de una clase propia, `Map`, `Set`, etc., que este paquete trata como un valor hoja, no como algo para recorrer campo a campo. */
function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v) || v instanceof Date) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Igualdad profunda de dos valores HOJA (nunca de dos objetos planos: esos
 * los recorre `diff` campo a campo, no acá). Cubre lo que pide la tarea:
 * `bigint` (`===` ya compara por valor, no por referencia), `Date`
 * (comparadas por `getTime()`, no por referencia ni por `===`) y arreglos
 * — **comparados como valor entero, no elemento a elemento**: si algo
 * adentro cambió, el campo entero se reporta como un solo cambio con el
 * arreglo completo de antes y el de después, nunca un cambio por índice.
 * Documentado también en el JSDoc de `loQueCambio`.
 *
 * `pila` evita recursión infinita si un arreglo o un objeto adentro de un
 * arreglo se referencia a sí mismo — mismo mecanismo de pila de ancestros
 * que usa `diff` (agregar antes de bajar, sacar al volver), así que un
 * valor que aparece dos veces SIN ciclo (un DAG, no un self-reference) no
 * se confunde con un ciclo real.
 */
function sonIguales(a: unknown, b: unknown, pila: Set<object> = new Set()): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    if (pila.has(a)) return pila.has(b);
    if (a.length !== b.length) return false;
    pila.add(a);
    try {
      return a.every((v, i) => sonIguales(v, b[i], pila));
    } finally {
      pila.delete(a);
    }
  }
  if (esObjetoPlano(a) && esObjetoPlano(b)) {
    if (pila.has(a)) return pila.has(b);
    const clavesA = Object.keys(a);
    const clavesB = Object.keys(b);
    if (clavesA.length !== clavesB.length) return false;
    pila.add(a);
    try {
      return clavesA.every((clave) => clave in b && sonIguales(a[clave], b[clave], pila));
    } finally {
      pila.delete(a);
    }
  }
  return false;
}

function diff(
  antesEntrada: unknown,
  despuesEntrada: unknown,
  ruta: string,
  cambios: CambioAuditoria[],
  pilaAntes: Set<object>,
  pilaDespues: Set<object>,
): void {
  // Un lado AUSENTE (`undefined`) contra un objeto plano del otro lado se
  // trata como si el lado ausente fuera `{}`, para poder expandir el diff
  // CAMPO A CAMPO en vez de reportar el objeto entero como un solo cambio.
  // Es el caso típico de `auditar` con una entidad recién CREADA (`antes`
  // ausente, `despues` la entidad completa) o BORRADA (al revés): cada
  // campo aparece como agregado/quitado por separado, que es más útil que
  // un único blob — y consistente con "una clave agregada o quitada se ve
  // como su valor pasando desde/hacia `undefined`" aplicado también al
  // nivel más externo, no solo a las claves de un objeto ya emparejado.
  // Con los DOS lados ausentes (o un lado ausente contra algo que NO es un
  // objeto plano, ej. un string) no aplica: eso sigue siendo una
  // comparación de valor normal, más abajo.
  const antes = antesEntrada === undefined && esObjetoPlano(despuesEntrada) ? {} : antesEntrada;
  const despues = despuesEntrada === undefined && esObjetoPlano(antesEntrada) ? {} : despuesEntrada;

  const antesEsObjeto = typeof antes === "object" && antes !== null;
  const despuesEsObjeto = typeof despues === "object" && despues !== null;

  // Ciclo: `antes`/`despues` en esta rama ya son un ANCESTRO de sí mismos en
  // su propio camino de recorrido (no simplemente "ya visto en otra rama" —
  // eso sería un DAG, no un ciclo, y es un caso legítimo que no hay que
  // frenar). Se reporta el campo como "[ciclo]" y se corta acá: seguir
  // bajando por esta rama nunca termina.
  if ((antesEsObjeto && pilaAntes.has(antes as object)) || (despuesEsObjeto && pilaDespues.has(despues as object))) {
    cambios.push({ campo: ruta || "(raiz)", antes: "[ciclo]", despues: "[ciclo]" });
    return;
  }

  if (esObjetoPlano(antes) && esObjetoPlano(despues)) {
    pilaAntes.add(antes);
    pilaDespues.add(despues);
    try {
      const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
      for (const clave of claves) {
        const subRuta = ruta ? `${ruta}.${clave}` : clave;
        // Indexar una clave ausente da `undefined` — así "undefined
        // significa que la clave no está" sale solo, sin lógica aparte:
        // una clave agregada o quitada entre `antes`/`despues` se ve acá
        // igual que un valor que pasó a/desde `undefined`.
        diff(antes[clave], despues[clave], subRuta, cambios, pilaAntes, pilaDespues);
      }
    } finally {
      pilaAntes.delete(antes);
      pilaDespues.delete(despues);
    }
    return;
  }

  if (!sonIguales(antes, despues)) {
    cambios.push({ campo: ruta || "(raiz)", antes, despues });
  }
}

/**
 * Los campos que cambiaron entre `antes` y `despues`: `{ campo, antes,
 * despues }[]`, uno por cada diferencia, **ordenado por `campo`**
 * (comparación de string simple, no `localeCompare` — determinístico sin
 * depender del locale del proceso que corre esto).
 *
 * Recorre objetos PLANOS recursivamente y arma la ruta de cada campo
 * anidado con puntos (`"direccion.calle"`). Un objeto no plano — arreglo,
 * `Date`, instancia de una clase propia, `Map`, `Set`, ... — se trata como
 * un valor HOJA: se compara entero, nunca se recorre campo a campo.
 *
 * **Los arreglos se comparan como valor entero, no elemento a elemento.**
 * `loQueCambio({ tags: ["a", "b"] }, { tags: ["a", "c"] })` da UN cambio en
 * `"tags"` con el arreglo completo de antes y el de después — no un cambio
 * en `"tags.1"`. Es una decisión deliberada: un arreglo no tiene una
 * identidad de posición estable en el dominio de negocio típico (reordenar,
 * insertar en el medio, sacar un elemento — todo mueve los índices de los
 * que quedan), así que diffear por índice produciría "cambios" que no
 * reflejan ninguna edición real. Si una app necesita el diff FINO de un
 * arreglo propio, tiene que armarlo aparte antes de llamar a esta función.
 *
 * Otros casos: `bigint` se compara por valor (`123n === 123n`, ya lo hace
 * `===`); `Date` se compara por `getTime()` (dos instancias distintas con
 * el mismo instante son iguales); `null` y `undefined` son SIEMPRE
 * distintos entre sí (`undefined` significa que la clave está ausente, no
 * "sin valor" — una clave con `null` explícito y una clave ausente SON un
 * cambio); una clave agregada o quitada entre `antes` y `despues` se ve
 * como su valor pasando desde/hacia `undefined`.
 *
 * **Nunca tira por un ciclo.** Si `antes` o `despues` tienen una referencia
 * circular (`obj.self = obj`), esa rama se detecta y se reporta con
 * `antes`/`despues` en el string `"[ciclo]"`, sin recursión infinita — ver
 * el detalle en `diff` (interno).
 *
 * Con `antes` y `despues` ausentes (`undefined` los dos, el caso de
 * `auditar` sin `antes` ni `despues`), devuelve `[]`.
 *
 * **Un lado ausente contra un objeto plano del otro lado se expande CAMPO A
 * CAMPO**, no como un solo cambio con el objeto entero: `loQueCambio(undefined,
 * { nombre: "Silla", precio: 100 })` (el caso típico de auditar una entidad
 * recién CREADA, sin "antes") da DOS cambios — `"nombre"` y `"precio"`, cada
 * uno con `antes: undefined` — no uno solo en `"(raiz)"`. Mismo criterio al
 * revés para una entidad BORRADA (`despues` ausente). Si el lado presente NO
 * es un objeto plano (un string, un número, ...), no aplica: ahí sí es un
 * solo cambio de valor entero (ver el ejemplo de abajo).
 *
 * ```ts
 * import { loQueCambio } from "@mafesoftware/auditoria";
 *
 * loQueCambio({ nombre: "Ana", direccion: { calle: "Corrientes 1", ciudad: "CABA" } },
 *             { nombre: "Ana", direccion: { calle: "Corrientes 2", ciudad: "CABA" } });
 * // [{ campo: "direccion.calle", antes: "Corrientes 1", despues: "Corrientes 2" }]
 *
 * loQueCambio({ saldo: 100n }, { saldo: 150n });
 * // [{ campo: "saldo", antes: 100n, despues: 150n }]
 *
 * loQueCambio({ vence: new Date("2026-01-01") }, { vence: new Date("2026-01-01") });
 * // [] (misma fecha, aunque sean instancias distintas de Date)
 *
 * loQueCambio({ activo: true }, { activo: true, nuevo: "x" });
 * // [{ campo: "nuevo", antes: undefined, despues: "x" }] (clave agregada)
 *
 * loQueCambio(undefined, undefined); // []
 *
 * loQueCambio(undefined, { nombre: "Silla", precio: 100 });
 * // [{ campo: "nombre", antes: undefined, despues: "Silla" }, { campo: "precio", antes: undefined, despues: 100 }]
 * // ("antes" ausente contra un objeto plano se expande campo a campo, no un solo cambio en "(raiz)")
 *
 * loQueCambio(undefined, "texto"); // [{ campo: "(raiz)", antes: undefined, despues: "texto" }] (el lado presente no es un objeto: un solo cambio)
 * ```
 */
export function loQueCambio(antes: unknown, despues: unknown): CambioAuditoria[] {
  const cambios: CambioAuditoria[] = [];
  diff(antes, despues, "", cambios, new Set(), new Set());
  cambios.sort((a, b) => (a.campo < b.campo ? -1 : a.campo > b.campo ? 1 : 0));
  return cambios;
}
