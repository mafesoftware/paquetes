import { colaSensible, normalizarTerminos, puntosMaximos } from "./coincidencia-sensible.js";
import { clasificar, clavesPropias, definirPropiedad, elementosDeSet, entradasDeMap, intentar, llamarToJSON } from "./tipos-especiales.js";

/**
 * Los nombres de campo que `redactar` tapa por defecto, en cualquier
 * profundidad. Cubren credenciales/secretos genéricos (`password`, `hash`,
 * `token`, `secret`, `api_key`, `totp`, `authorization`) y los datos
 * bancarios argentinos que este paquete espera ver en los productos de MAFE
 * Software (`cbu`, `cvu`) — `documentos-ar` valida su formato, pero nunca
 * deberían aparecer en texto plano en un registro de auditoría legible por
 * cualquiera con acceso de soporte.
 *
 * El matching no es por igualdad exacta: ver `esClaveSensible` (matchea
 * también si el nombre TERMINA con un término de esta lista) y el JSDoc de
 * `redactar` para la regla completa con ejemplos.
 */
export const CAMPOS_SENSIBLES_POR_DEFECTO: readonly string[] = [
  "contrasena",
  "password",
  "passwords",
  "hash",
  "token",
  "tokens",
  "secreto",
  "secreta",
  "secretos",
  "secretas",
  "secret",
  "secrets",
  "cbu",
  "cvu",
  "clave",
  "api_key",
  "apikey",
  "totp",
  "authorization",
];

/**
 * Lee `objeto[clave]`, atrapando una excepción si `clave` es un getter que
 * tira (una clase con una propiedad computada rota, por ejemplo) — para que
 * una lectura rota de UNA clave no tire toda la redacción. Devuelve
 * `{ ok: true, valor }` o `{ ok: false }`.
 */
function leerPropiedad(objeto: Record<string, unknown>, clave: string): { ok: true; valor: unknown } | { ok: false } {
  try {
    return { ok: true, valor: objeto[clave] };
  } catch {
    return { ok: false };
  }
}

/**
 * Lo que `redactarValor` arrastra en la recursión: los términos YA
 * normalizados, su `puntosMaximos` (calculado una vez) y la RUTA de claves
 * desde la raíz hasta el nodo actual. Los arreglos, `Set`s y `toJSON` no
 * suman segmento (igual que en las rutas de `loQueCambio`, donde un arreglo
 * es una hoja); las claves de objeto y de `Map` sí.
 */
interface Contexto {
  sensibles: ReadonlySet<string>;
  maxPuntos: number;
  ruta: string[];
}

/**
 * Redacta (o recorre) el valor de la clave `clave` de un objeto/`Map`. La
 * clave es sensible si ella sola lo es o, con un término con punto, si lo
 * es alguna cola de la ruta que termina en ella (`colaSensible`, acotada a
 * `maxPuntos + 1` segmentos): así `"cuenta.numero"` tapa `{ cuenta: {
 * numero } }` igual que la clave literal `"cuenta.numero"`.
 */
function redactarEntrada(clave: string, valor: unknown, ctx: Contexto, pila: Set<object>): unknown {
  ctx.ruta.push(clave);
  try {
    return colaSensible(ctx.ruta, ctx.ruta.length - 1, ctx.sensibles, ctx.maxPuntos) ? "[redactado]" : redactarValor(valor, ctx, pila);
  } finally {
    ctx.ruta.pop();
  }
}

function redactarValor(valor: unknown, ctx: Contexto, pila: Set<object>): unknown {
  if (Array.isArray(valor)) {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      return valor.map((v) => redactarValor(v, ctx, pila));
    } finally {
      pila.delete(valor);
    }
  }
  if (typeof valor !== "object" || valor === null) {
    // Valor hoja (string, number, bigint, boolean, null, undefined, symbol,
    // función): se devuelve tal cual, no hay clave que revisar acá arriba.
    return valor;
  }

  // `clasificar` (ver tipos-especiales.ts) reconoce binario/Date/RegExp/
  // URL/Error/toJSON/Map/Set en ESE orden, y devuelve una CLASIFICACIÓN,
  // no el recorrido — acá se hace lo que corresponde para cada una. Corre
  // SIEMPRE envuelta en `intentar`: los `instanceof`/`tieneToJSON` de adentro
  // pueden tirar por un dato roto (un `Proxy` con `getPrototypeOf`/`get`
  // rotos, un `Error` con `.name` que tira) — si tira, TODO el nodo queda
  // `"[error]"`, nunca se propaga.
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
      // El resultado de toJSON() se redacta/recorre recursivamente — puede
      // ser cualquier cosa (un string, como en decimal.js; un objeto; un
      // arreglo). `pila` sigue agregado por si el toJSON devuelve `this`
      // (patológico, pero posible): la próxima vuelta lo detecta como
      // ancestro y corta con "[ciclo]" en vez de loopear para siempre.
      return redactarValor(llamado.valor, ctx, pila);
    } finally {
      pila.delete(valor);
    }
  }

  if (c.tipo === "map") {
    if (pila.has(valor)) return "[ciclo]";
    pila.add(valor);
    try {
      // Ronda 5: OBJETO plano con la clave como texto, desambiguada con
      // " (2)", " (3)"… si dos claves dan el mismo texto (`entradasDeMap`,
      // el mismo cálculo que `serializarParaAuditoria`/`normalizarParaDiff`).
      // P.10b: la sensibilidad la decide `esClaveSensible` sobre la clave
      // FINAL, igual que en la rama de objeto de abajo (ella misma saca el
      // sufijo de colisión): `"password (2)"` sigue siendo sensible. Una
      // iteración que tira deja el nodo en "[error]" (M2).
      const leidas = entradasDeMap(valor as Map<unknown, unknown>);
      if (!leidas.ok) return "[error]";
      const resultado: Record<string, unknown> = {};
      for (const { clave, valor: v } of leidas.entradas) {
        definirPropiedad(resultado, clave, redactarEntrada(clave, v, ctx, pila));
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
      return leidos.elementos.map((v) => redactarValor(v, ctx, pila));
    } finally {
      pila.delete(valor);
    }
  }

  // c.tipo === "objeto": CUALQUIER objeto que no sea arreglo/binario/Date/
  // RegExp/URL/Error/(algo con toJSON)/Map/Set — objeto plano, instancia
  // de una clase propia, lo que sea — se recorre por sus claves propias
  // ENUMERABLES (`Object.keys`, que para una instancia de clase son los
  // campos de instancia, ej. `this.password = ...` en el constructor,
  // NUNCA los métodos del prototipo).
  if (pila.has(valor)) return "[ciclo]";
  pila.add(valor);
  try {
    const objeto = valor as Record<string, unknown>;
    const clavesLeidas = clavesPropias(objeto);
    // Object.keys puede tirar (un Proxy cuya trampa ownKeys tira): sin
    // poder enumerar nada, no hay forma de redactar nada adentro — se
    // devuelve "[error]" para todo el objeto, no se propaga la excepción.
    if (!clavesLeidas.ok) return "[error]";
    const resultado: Record<string, unknown> = {};
    for (const clave of clavesLeidas.claves) {
      const leido = leerPropiedad(objeto, clave);
      if (!leido.ok) {
        definirPropiedad(resultado, clave, "[error]");
        continue;
      }
      definirPropiedad(resultado, clave, redactarEntrada(clave, leido.valor, ctx, pila));
    }
    return resultado;
  } finally {
    pila.delete(valor);
  }
}

/**
 * Una copia profunda de `obj` donde cualquier CLAVE sensible (según
 * `esClaveSensible`: el nombre normalizado IGUALA o TERMINA CON un término
 * de `camposSensibles`, normalizado de la misma forma) queda reemplazada
 * por `"[redactado]"`, sin importar
 * la profundidad ni si está adentro de un arreglo, un `Map`, un `Set` o una
 * instancia de una clase propia. `camposSensibles` es por defecto
 * `CAMPOS_SENSIBLES_POR_DEFECTO`.
 *
 * **Normalización** (la misma para claves de objeto, claves de `Map`,
 * segmentos de ruta de `redactarCambios` y los términos de la lista), en
 * orden: (1) Unicode NFKD y se quitan las marcas combinantes y los
 * caracteres de formato invisibles `\p{Cf}` (`"contraseña"` →
 * `"contrasena"`, `"ＰＡＳＳＷＯＲＤ"` → `"PASSWORD"`, `"pass\u200Bword"` →
 * `"password"`); (2) se saca el sufijo de colisión final `" (N)"`
 * (`"password (2)"` → `"password"`); (3) minúsculas; (4) se quitan `_`, `-`
 * y espacios (`"clave_secreta"` → `"clavesecreta"`, que termina en
 * `"secreta"`; `"api key"` → `"apikey"`). En el paso (1) también se quitan
 * los caracteres de control `\p{Cc}`. El punto NO se quita: `"api.key"` no
 * matchea `"apikey"`, pero sí un término propio `"api.key"`. Un término con
 * punto se prueba contra la clave y contra las colas de la ruta de claves
 * que terminan en ella (a lo sumo `puntos + 1` segmentos): `"cuenta.numero"`
 * tapa `{ cuenta: { numero } }` y la clave literal `"cuenta.numero"`; los
 * arreglos/`Set`s no suman segmento. Un término que normaliza a `""` se
 * descarta. Tapar de más es el costo aceptado: una clave literal
 * `"password (2)"` se tapa aunque no venga de un `Map`.
 *
 * **La regla de matching es "igual O termina con", no "contiene".** Con
 * `"password"` en la lista:
 * - `"passwordHash"` / `"password_hash"` SÍ se redactan (normalizan a
 *   `"passwordhash"`, que no es igual a `"password"` pero SÍ termina con
 *   `"hash"`, que también está en la lista por defecto).
 * - `"accessToken"` / `"refresh_token"` SÍ (terminan en `"token"`).
 * - `"clientSecret"` SÍ (termina en `"secret"`).
 * - `"x-api-key"` SÍ (normaliza a `"xapikey"`, termina en `"apikey"`).
 * - `"passwordHint"` NO se redacta: normaliza a `"passwordhint"`, que NO
 *   termina en `"password"` (`"password"` es un PREFIJO ahí, no un
 *   sufijo) ni en ningún otro término de la lista.
 * - `"tokenizer"` NO se redacta: no termina en `"token"` (queda al
 *   principio, no al final).
 *
 * Es una redacción por NOMBRE DE CLAVE, no por valor: no mira si el string
 * "parece" una contraseña. **Límite documentado**: un secreto guardado bajo
 * una clave NO sensible (ej. `{ notas: "la clave temporal es Xy9$zK" }`,
 * donde la clave del objeto es `"notas"`, no `"clave"`) NO se detecta —
 * `redactar` nunca mira el CONTENIDO de un string, solo el nombre de la
 * clave que lo contiene.
 *
 * **Otros dos límites de la regla "termina con", documentados**:
 * - **Un plural arbitrario NO matchea su singular**: `"passwordHint"` no
 *   termina en `"password"`, pero TAMPOCO `"misPasswords"` termina en
 *   `"password"` — termina en `"passwords"` (con la "s" de plural), que es
 *   un sufijo DISTINTO. Por eso la lista default incluye explícitamente
 *   `"passwords"`, `"tokens"` y `"secrets"` (los plurales más comunes) como
 *   términos propios, no derivados automáticamente de sus singulares — un
 *   plural que no esté en la lista (`"apiKeys"`, `"hashes"`, ...) sigue sin matchear a menos que se agregue a mano en
 *   `camposSensibles`.
 * - **La clave de un `Map` queda como TEXTO en el resultado, sin redactar
 *   por su CONTENIDO** (solo el nombre de la clave decide si el VALOR de
 *   esa entrada se tapa, igual que con un objeto). Si una app usa un
 *   secreto COMO clave de un `Map` (ej. `new Map([[apiKeySecret,
 *   metadata]])`, en vez de `{ apiKey: secreto }`), ese secreto sale
 *   intacto como nombre de propiedad del resultado (y como segmento de la
 *   ruta en `cambios`)
 *   — `redactar` no tiene forma de saber que el CONTENIDO de esa clave es
 *   sensible, solo mira nombres de clave declarados (de un objeto, o ya
 *   convertidos a texto de un `Map`). No uses un valor sensible como clave
 *   de un `Map` que vaya a pasar por `redactar`.
 *
 * **Tipos especiales** (mismo tratamiento que `serializarParaAuditoria`,
 * mismo orden — ver `tipos-especiales.ts`):
 * - `Buffer`/`TypedArray`/`ArrayBuffer`/`DataView` → `"[binario N bytes]"`
 *   (nunca el contenido byte a byte).
 * - `Date` → ISO string (`"[fecha-invalida]"` si es una Date inválida).
 * - `RegExp` → `String(re)` (ej. `"/abc/gi"`).
 * - `URL` → `origin` + `pathname`, SIN `search` ni `hash` (pueden traer
 *   secretos: `?token=...`, `#access_token=...`).
 * - `Error` → `{ name }` únicamente (nunca `.message`, que puede traer el
 *   valor que causó el error).
 * - Cualquier OTRO objeto con un `toJSON` propio: se llama (atrapando una
 *   excepción — `"[error]"` si tira) y el resultado se redacta
 *   recursivamente. Corre DESPUÉS de los casos de arriba a propósito:
 *   `URL.prototype.toJSON` existe y devuelve el `href` COMPLETO (con
 *   query/hash), así que si este chequeo corriera antes, la redacción
 *   específica de `URL` nunca se alcanzaría.
 * - `Map` se convierte a un OBJETO plano con la clave como texto. Si dos
 *   claves distintas dan el mismo texto (el número `1` y el string `"1"`),
 *   la que llegó después (orden de inserción) lleva un sufijo `" (2)"`,
 *   `" (3)"`…, así ninguna se pierde. Una entrada cuya clave (como texto,
 *   sin sufijo) es sensible tiene su VALOR redactado.
 * - `Set` se convierte a un arreglo. Un `Map`/`Set` cuya iteración tira
 *   (un `Proxy` sobre un `Map`, una subclase con un `entries()` roto)
 *   queda `"[error]"`.
 *
 * Nunca tira: una referencia circular queda como `"[ciclo]"`, una clave
 * cuyo `get` tira queda como `"[error]"`, una clave de `Map` cuyo
 * `toString` tira (o un objeto sin prototipo como clave) queda como
 * `"[clave]"`, y un objeto cuyas claves no se pueden enumerar (un `Proxy`
 * con una trampa `ownKeys` que tira) queda como `"[error]"` entero.
 *
 * ```ts
 * import { redactar, CAMPOS_SENSIBLES_POR_DEFECTO } from "@mafesoftware/auditoria";
 *
 * redactar({ usuario: "ana", contrasena: "hunter2" });
 * // { usuario: "ana", contrasena: "[redactado]" }
 *
 * redactar({ pago: { datos: { cbu: "0000003100010000000001", monto: 100 } } });
 * // { pago: { datos: { cbu: "[redactado]", monto: 100 } } }
 *
 * redactar({ passwordHash: "h1", accessToken: "t1", refresh_token: "t2", clientSecret: "s1", "x-api-key": "k1" });
 * // { passwordHash: "[redactado]", accessToken: "[redactado]", refresh_token: "[redactado]", clientSecret: "[redactado]", "x-api-key": "[redactado]" }
 *
 * redactar({ passwordHint: "el nombre de tu mascota", tokenizer: "spacy" });
 * // { passwordHint: "el nombre de tu mascota", tokenizer: "spacy" } (NINGUNO se toca: no terminan en un término sensible)
 *
 * redactar({ token: "t1", extra: "visible" }, ["token"]); // lista propia
 * // { token: "[redactado]", extra: "visible" }
 *
 * class Usuario { constructor(public nombre: string, public password: string) {} }
 * redactar(new Usuario("ana", "hunter2"));
 * // { nombre: "ana", password: "[redactado]" } (instancia de clase: se redactan sus campos propios)
 *
 * redactar(new URL("https://api.com/perfil?token=SECRETO#frag"));
 * // "https://api.com/perfil" (sin "?token=SECRETO" ni "#frag")
 *
 * class Dinero { constructor(private centavos: bigint) {} toJSON() { return `${this.centavos}c`; } }
 * redactar({ precio: new Dinero(1250n) });
 * // { precio: "1250c" } (toJSON corre y su resultado se redacta/recorre)
 *
 * redactar(new Map<unknown, string>([[1, "hunter2"], ["1", "x"], ["contrasena", "hunter3"]]));
 * // { "1": "hunter2", "1 (2)": "x", contrasena: "[redactado]" } (objeto; la clave repetida como texto lleva sufijo)
 *
 * redactar({ contraseña: "a", CONTRASEÑA: "b", clave_secreta: "c", "password (2)": "d" });
 * // { contraseña: "[redactado]", CONTRASEÑA: "[redactado]", clave_secreta: "[redactado]", "password (2)": "[redactado]" }
 *
 * redactar({ Código: "x", codigo: "y" }, ["código"]); // término propio con acento
 * // { Código: "[redactado]", codigo: "[redactado]" }
 *
 * redactar({ passwords: ["hunter2", "hunter3"], tokens: ["t1"], secrets: ["s1"] });
 * // { passwords: "[redactado]", tokens: "[redactado]", secrets: "[redactado]" } (plurales EXPLÍCITOS en la lista default)
 *
 * CAMPOS_SENSIBLES_POR_DEFECTO;
 * // ["contrasena", "password", "passwords", "hash", "token", "tokens", "secreto", "secreta", "secretos", "secretas", "secret", "secrets", "cbu", "cvu", "clave", "api_key", "apikey", "totp", "authorization"]
 * ```
 */
export function redactar<T>(obj: T, camposSensibles: readonly string[] = CAMPOS_SENSIBLES_POR_DEFECTO): T {
  return redactarConTerminos(obj, normalizarTerminos(camposSensibles));
}

/**
 * `redactar` con los términos YA normalizados (`normalizarTerminos`). Interno
 * (no se reexporta desde `index.ts`): lo usa `redactarCambios` para no
 * volver a normalizar la lista en cada cambio. `rutaInicial` son las claves
 * de los ancestros de `obj` (la ruta del cambio), para que un término con
 * punto se evalúe igual que en las copias guardadas.
 */
export function redactarConTerminos<T>(obj: T, terminosNormalizados: ReadonlySet<string>, rutaInicial: readonly string[] = []): T {
  const ctx: Contexto = { sensibles: terminosNormalizados, maxPuntos: puntosMaximos(terminosNormalizados), ruta: [...rutaInicial] };
  return redactarValor(obj, ctx, new Set()) as T;
}
