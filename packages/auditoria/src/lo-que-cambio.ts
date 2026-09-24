import { definirPropiedad, esArreglo, excedeProfundidad, intentar, PROFUNDIDAD_MAXIMA, TEXTO_PROFUNDIDAD } from "./tipos-especiales.js";

/** Un campo que cambió entre `antes` y `despues`. */
export interface CambioAuditoria {
  /** La ruta con puntos hasta el campo (ej. `"direccion.calle"`), o `"(raiz)"` si `antes`/`despues` no son objetos. */
  campo: string;
  antes: unknown;
  despues: unknown;
}

/**
 * Un objeto "plano": no `null`, no arreglo, no `Date`, y con el prototipo
 * de `Object` (o sin prototipo) — nunca una instancia de una clase propia,
 * `Map`, `Set`, etc., que este paquete trata como un valor hoja, no como
 * algo para recorrer campo a campo.
 *
 * El chequeo entero corre envuelto en `intentar` (ver `tipos-especiales.ts`):
 * `Array.isArray` (tira sobre un `Proxy` revocado), `v instanceof Date` y
 * `Object.getPrototypeOf(v)` (hacen `[[GetPrototypeOf]]`, que en un `Proxy`
 * dispara esa trampa) pueden tirar. Si tira, se trata como NO plano. `diff`
 * detecta antes esos nodos con `inspeccionable` y los convierte en
 * `"[error]"`; esto es la segunda red, para `sonIguales`.
 */
function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const resultado = intentar(() => {
    if (Array.isArray(v) || v instanceof Date) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  });
  return resultado.ok && resultado.valor;
}

/**
 * ¿Se puede inspeccionar `v` sin que tire? Para un objeto, prueba
 * `Array.isArray` y `Object.getPrototypeOf` (lo que necesitan `diff`,
 * `esObjetoPlano` y un `instanceof`): un `Proxy` revocado o uno con la
 * trampa `getPrototypeOf` rota no pasan. Un primitivo siempre pasa.
 */
function inspeccionable(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return true;
  return intentar(() => {
    Array.isArray(v);
    Object.getPrototypeOf(v);
  }).ok;
}

/** `v`, o `"[error]"` si no se puede inspeccionar (ver `inspeccionable`). */
function oError(v: unknown): unknown {
  return inspeccionable(v) ? v : "[error]";
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
 *
 * **Nunca tira** (ronda 5, M3): el cuerpo entero va en `intentar`. Un
 * `instanceof` sobre un `Proxy` roto, un `ownKeys` que tira, un `has` que
 * tira o un getter que tira, en cualquier punto de la comparación, dan
 * `false` ("no son iguales") — el cambio se reporta, nunca se esconde.
 */
/**
 * Marca (no enumerable, así no cambia la forma visible del cambio ni lo que
 * se serializa) del cambio de la RAÍZ verdadera. Antes `redactarCambios`
 * reconocía la raíz por el texto `campo === "(raiz)"`, que también da una
 * clave REAL llamada `"(raiz)"` — y esa clave se salteaba la redacción por
 * ruta. Un `Symbol` no lo puede producir ninguna clave.
 */
const RAIZ: unique symbol = Symbol("raiz");

/** ¿`cambio` es el de la raíz verdadera (no una clave llamada `"(raiz)"`)? Interno: lo usa `redactarCambios`. */
export function esCambioDeRaiz(cambio: CambioAuditoria): boolean {
  return (cambio as { [RAIZ]?: boolean })[RAIZ] === true;
}

/** Un contenedor más hondo que `PROFUNDIDAD_MAXIMA` se compara (y se reporta) como `"[profundidad]"`. */
function cortar(v: unknown, profundidad: number): unknown {
  return excedeProfundidad(v, profundidad) ? TEXTO_PROFUNDIDAD : v;
}

/** ¿Hay, adentro de `v` (arreglos y objetos planos), un contenedor más hondo que el tope? Recursión acotada por el tope. */
function excede(v: unknown, profundidad: number, pila: Set<object>): boolean {
  if (typeof v !== "object" || v === null) return false;
  if (profundidad > PROFUNDIDAD_MAXIMA) return true;
  if (pila.has(v)) return false;
  const arreglo = esArreglo(v);
  if (arreglo === "error") return false;
  if (!arreglo && !esObjetoPlano(v)) return false;
  const claves = clavesOIndefinido(v);
  if (claves === undefined) return false;
  pila.add(v);
  try {
    return claves.some((clave) => excede(leerOError(v as Record<string, unknown>, clave), profundidad + 1, pila));
  } finally {
    pila.delete(v);
  }
}

/** Copia de `v` con los contenedores más hondos que el tope reemplazados por `"[profundidad]"` (solo arreglos y objetos planos; lo demás es una hoja y va tal cual). */
function copiarCortado(v: unknown, profundidad: number, pila: Set<object>): unknown {
  if (typeof v !== "object" || v === null) return v;
  if (profundidad > PROFUNDIDAD_MAXIMA) return TEXTO_PROFUNDIDAD;
  if (pila.has(v)) return "[ciclo]";
  const arreglo = esArreglo(v);
  if (arreglo === "error" || (!arreglo && !esObjetoPlano(v))) return v;
  const claves = clavesOIndefinido(v);
  if (claves === undefined) return v;
  pila.add(v);
  try {
    if (arreglo) return claves.map((clave) => copiarCortado(leerOError(v as Record<string, unknown>, clave), profundidad + 1, pila));
    const copia: Record<string, unknown> = {};
    for (const clave of claves) definirPropiedad(copia, clave, copiarCortado(leerOError(v as Record<string, unknown>, clave), profundidad + 1, pila));
    return copia;
  } finally {
    pila.delete(v);
  }
}

/**
 * El valor de un lado de un cambio, como se devuelve: el MISMO valor si
 * nada adentro pasa el tope (lo normal — se conservan las referencias), o
 * una copia cortada si algo lo pasa (así un secreto más hondo que el tope no
 * sale de `loQueCambio`).
 */
function acotar(v: unknown, profundidad: number): unknown {
  // `excede` y `copiarCortado` no tiran: toda inspección pasa por
  // `esArreglo`/`esObjetoPlano`/`clavesOIndefinido`/`leerOError`, ya guardadas.
  return excede(v, profundidad, new Set()) ? copiarCortado(v, profundidad, new Set()) : v;
}

/** Agrega un cambio, con los valores acotados y la marca de raíz si corresponde. */
function registrar(cambios: CambioAuditoria[], ruta: string, profundidad: number, antes: unknown, despues: unknown): void {
  const cambio: CambioAuditoria = { campo: ruta || "(raiz)", antes: acotar(antes, profundidad), despues: acotar(despues, profundidad) };
  if (profundidad === 0) Object.defineProperty(cambio, RAIZ, { value: true, enumerable: false });
  cambios.push(cambio);
}

function sonIguales(a: unknown, b: unknown, profundidad: number): boolean {
  const r = intentar(() => sonIgualesSinGuardia(a, b, new Set(), profundidad));
  return r.ok && r.valor;
}

function sonIgualesSinGuardia(a: unknown, b: unknown, pila: Set<object>, profundidad: number): boolean {
  if (a === b) return true;
  // P1: más abajo del tope, un contenedor es "[profundidad]" de los dos lados (igual, como en las copias guardadas).
  if (profundidad > PROFUNDIDAD_MAXIMA) return cortar(a, profundidad) === cortar(b, profundidad);
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    if (pila.has(a)) return pila.has(b);
    if (a.length !== b.length) return false;
    pila.add(a);
    try {
      return a.every((v, i) => sonIgualesSinGuardia(v, b[i], pila, profundidad + 1));
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
      return clavesA.every((clave) => clave in b && sonIgualesSinGuardia(a[clave], b[clave], pila, profundidad + 1));
    } finally {
      pila.delete(a);
    }
  }
  return false;
}

/** `Object.keys(v)`, o `undefined` si tira (un `Proxy` con `ownKeys`/`getOwnPropertyDescriptor` rotos). */
function clavesOIndefinido(v: object): string[] | undefined {
  const r = intentar(() => Object.keys(v));
  return r.ok ? r.valor : undefined;
}

/** `objeto[clave]`, o `"[error]"` si la lectura tira (un getter roto, un `get` de `Proxy` roto). */
function leerOError(objeto: Record<string, unknown>, clave: string): unknown {
  const r = intentar(() => objeto[clave]);
  return r.ok ? r.valor : "[error]";
}

function diff(
  antesEntrada: unknown,
  despuesEntrada: unknown,
  ruta: string,
  cambios: CambioAuditoria[],
  pilaAntes: Set<object>,
  pilaDespues: Set<object>,
  profundidad: number,
): void {
  // Misma REFERENCIA (o mismo primitivo) de los dos lados: no hay nada que
  // reportar. Además de ser el caso obvio (`loQueCambio(x, x)` con `x` lo
  // que sea), es lo que evita un falso `"[ciclo]"` cuando `x` es un objeto
  // AUTOREFERENCIAL (`x.self = x`) pasado literalmente igual de los dos
  // lados: sin este corte, bajar a la clave `"self"` encontraría a `x` como
  // ancestro de sí mismo (ver la pila más abajo) y lo reportaría como un
  // cambio, aunque los dos lados sean EXACTAMENTE el mismo objeto — nunca
  // hubo ninguna edición. Los ancestros DISTINTOS-pero-cíclicos (dos
  // objetos autoreferenciales diferentes, `objA !== objB`) siguen
  // detectándose más abajo y reportándose como `"[ciclo]"`: acá solo se
  // corta el caso en el que literalmente no hay diferencia posible.
  if (antesEntrada === despuesEntrada) return;

  // P1 (ronda de fix 3): más abajo del tope no se recorre; un contenedor se
  // compara como "[profundidad]". Se chequea con `typeof` nada más, antes de
  // cualquier inspección.
  if (profundidad > PROFUNDIDAD_MAXIMA) {
    const a = cortar(antesEntrada, profundidad);
    const d = cortar(despuesEntrada, profundidad);
    if (a !== d) registrar(cambios, ruta, profundidad, a, d);
    return;
  }

  // Ronda 5 (M3): un nodo que no se puede inspeccionar (un `Proxy` revocado,
  // uno con `getPrototypeOf` roto) se reemplaza por `"[error]"` antes de
  // cualquier otra cosa — así nada de lo que sigue puede tirar por él.
  if (!inspeccionable(antesEntrada) || !inspeccionable(despuesEntrada)) {
    diff(oError(antesEntrada), oError(despuesEntrada), ruta, cambios, pilaAntes, pilaDespues, profundidad);
    return;
  }

  // Un lado AUSENTE (`undefined` O `null` — los dos cuentan como "no hay
  // nada de este lado" para esto) contra un objeto plano del otro lado se
  // trata como si el lado ausente fuera `{}`, para poder expandir el diff
  // CAMPO A CAMPO en vez de reportar el objeto entero como un solo cambio.
  // Es el caso típico de `auditar` con una entidad recién CREADA (`antes`
  // ausente, `despues` la entidad completa — al alta, algunas apps pasan
  // `antes: undefined` y otras `antes: null`, las dos tienen que dar el
  // mismo resultado) o BORRADA (al revés): cada campo aparece como
  // agregado/quitado por separado, que es más útil que un único blob — y
  // consistente con "una clave agregada o quitada se ve como su valor
  // pasando desde/hacia `undefined`" aplicado también al nivel más externo,
  // no solo a las claves de un objeto ya emparejado. Con los DOS lados
  // ausentes (o un lado ausente contra algo que NO es un objeto plano, ej.
  // un string) no aplica: eso sigue siendo una comparación de valor normal,
  // más abajo. Esto NO cambia que `null` y `undefined` sigan siendo
  // valores DISTINTOS entre sí en una comparación directa (ver el JSDoc de
  // `loQueCambio`): una clave con `null` explícito contra la MISMA clave
  // ausente en el otro lado sigue siendo un cambio (`antes: null, despues:
  // undefined`), porque ninguno de los dos es, ahí, "un objeto plano del
  // otro lado" — la sustitución de acá solo dispara cuando el OTRO lado sí
  // es un objeto plano.
  const antesAusente = antesEntrada === undefined || antesEntrada === null;
  const despuesAusente = despuesEntrada === undefined || despuesEntrada === null;
  const antes = antesAusente && esObjetoPlano(despuesEntrada) ? {} : antesEntrada;
  const despues = despuesAusente && esObjetoPlano(antesEntrada) ? {} : despuesEntrada;

  const antesEsObjeto = typeof antes === "object" && antes !== null;
  const despuesEsObjeto = typeof despues === "object" && despues !== null;

  // Ciclo: `antes`/`despues` en esta rama ya son un ANCESTRO de sí mismos en
  // su propio camino de recorrido (no simplemente "ya visto en otra rama" —
  // eso sería un DAG, no un ciclo, y es un caso legítimo que no hay que
  // frenar). Se reporta el campo como "[ciclo]" y se corta acá: seguir
  // bajando por esta rama nunca termina.
  if ((antesEsObjeto && pilaAntes.has(antes as object)) || (despuesEsObjeto && pilaDespues.has(despues as object))) {
    registrar(cambios, ruta, profundidad, "[ciclo]", "[ciclo]");
    return;
  }

  if (esObjetoPlano(antes) && esObjetoPlano(despues)) {
    // M3: si las claves de un lado no se pueden enumerar (`ownKeys` roto),
    // ese lado entero pasa a ser `"[error]"` y se compara como hoja.
    const clavesAntes = clavesOIndefinido(antes);
    const clavesDespues = clavesOIndefinido(despues);
    if (clavesAntes === undefined || clavesDespues === undefined) {
      const a = clavesAntes === undefined ? "[error]" : antes;
      const d = clavesDespues === undefined ? "[error]" : despues;
      if (!sonIguales(a, d, profundidad)) registrar(cambios, ruta, profundidad, a, d);
      return;
    }
    pilaAntes.add(antes);
    pilaDespues.add(despues);
    try {
      const claves = new Set([...clavesAntes, ...clavesDespues]);
      for (const clave of claves) {
        const subRuta = ruta ? `${ruta}.${clave}` : clave;
        // Indexar una clave ausente da `undefined` — así "undefined
        // significa que la clave no está" sale solo, sin lógica aparte:
        // una clave agregada o quitada entre `antes`/`despues` se ve acá
        // igual que un valor que pasó a/desde `undefined`. Un getter que
        // tira da `"[error]"` (M3).
        diff(leerOError(antes, clave), leerOError(despues, clave), subRuta, cambios, pilaAntes, pilaDespues, profundidad + 1);
      }
    } finally {
      pilaAntes.delete(antes);
      pilaDespues.delete(despues);
    }
    return;
  }

  if (!sonIguales(antes, despues, profundidad)) {
    registrar(cambios, ruta, profundidad, antes, despues);
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
 * **Nunca tira, con ningún dato.** Es pública y puede recibir cualquier
 * cosa directo (sin pasar por `normalizarParaDiff`): un nodo que no se
 * puede inspeccionar — un `Proxy` revocado o con la trampa
 * `getPrototypeOf` rota, un objeto cuyas claves no se pueden enumerar
 * (`ownKeys` que tira), una propiedad cuyo getter tira — queda como el
 * string `"[error]"` en su lugar del diff (`{ get a() { throw } }` contra
 * `{ a: 1 }` da `[{ campo: "a", antes: "[error]", despues: 1 }]`). Si la
 * comparación de dos hojas (arreglos, por ejemplo) tira en algún punto,
 * se consideran DISTINTAS y el cambio se reporta con los valores tal cual
 * — nunca se esconde un cambio por no poder compararlo.
 *
 * **Profundidad máxima** (`PROFUNDIDAD_MAXIMA`, 500): más abajo del tope no
 * se recorre. Un contenedor ahí se compara como `"[profundidad]"` de los dos
 * lados — dos estructuras que solo difieren más abajo del tope NO generan
 * cambio, igual que sus copias guardadas (cortadas en el mismo lugar) — y un
 * primitivo por su valor. Un valor de hoja con algo más hondo que el tope se
 * devuelve como copia cortada; si no, el mismo valor. El cambio de la raíz
 * verdadera lleva una marca interna no enumerable (`esCambioDeRaiz`), para
 * que `redactarCambios` no confunda la raíz con una clave llamada
 * `"(raiz)"`.
 *
 * **Nunca tira por un ciclo, y `loQueCambio(x, x)` con `x` autoreferencial
 * da `[]`, no `"[ciclo]"`.** Los dos lados EXACTAMENTE el mismo valor
 * (misma referencia) se cortan antes de recorrer nada — no hay ninguna
 * diferencia posible, así que no se reporta nada, sin importar si `x` tiene
 * una referencia circular adentro. Cuando `antes` y `despues` SÍ son
 * objetos autoreferenciales DISTINTOS (`objA !== objB`, cada uno con su
 * propio ciclo, ej. `objA.self = objA` y `objB.self = objB`), esa rama no
 * se puede resolver sin recursión infinita y se reporta con `antes`/
 * `despues` en el string `"[ciclo]"` — ver el detalle en `diff` (interno).
 *
 * Con `antes` y `despues` ausentes (`undefined` o `null`, los dos — el
 * caso de `auditar` sin `antes` ni `despues`), devuelve `[]`.
 *
 * **Un lado ausente (`undefined` O `null`) contra un objeto plano del otro
 * lado se expande CAMPO A CAMPO**, no como un solo cambio con el objeto
 * entero: `loQueCambio(undefined, { nombre: "Silla", precio: 100 })` (el
 * caso típico de auditar una entidad recién CREADA, sin "antes" — algunas
 * apps pasan `antes: undefined`, otras `antes: null`, las dos dan el mismo
 * resultado) da DOS cambios — `"nombre"` y `"precio"`, cada uno con `antes:
 * undefined` — no uno solo en `"(raiz)"`. Mismo criterio al revés para una
 * entidad BORRADA (`despues` ausente). Si el lado presente NO es un objeto
 * plano (un string, un número, ...), no aplica: ahí sí es un solo cambio de
 * valor entero (ver el ejemplo de abajo). **Esto no cambia que `null` y
 * `undefined` sigan siendo valores DISTINTOS entre sí** en una comparación
 * directa: una clave con `null` explícito contra la MISMA clave ausente en
 * el otro lado sigue siendo un cambio (`antes: null, despues: undefined`) —
 * la expansión de acá solo dispara cuando el OTRO lado es un objeto plano,
 * no cuando los dos son ausentes o cuando el otro lado es otro primitivo.
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
 *
 * loQueCambio(null, { nombre: "Silla" }); // [{ campo: "nombre", antes: undefined, despues: "Silla" }] (null se trata igual que undefined acá)
 *
 * loQueCambio({ nota: null }, {}); // [{ campo: "nota", antes: null, despues: undefined }] (null y undefined siguen siendo DISTINTOS entre sí)
 *
 * const x: any = { a: 1 }; x.self = x;
 * loQueCambio(x, x); // [] (misma referencia de los dos lados: sin diferencia posible, aunque x sea autoreferencial)
 * ```
 */
export function loQueCambio(antes: unknown, despues: unknown): CambioAuditoria[] {
  const cambios: CambioAuditoria[] = [];
  diff(antes, despues, "", cambios, new Set(), new Set(), 0);
  cambios.sort((a, b) => (a.campo < b.campo ? -1 : a.campo > b.campo ? 1 : 0));
  return cambios;
}
