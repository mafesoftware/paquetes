# Changelog

## 0.2.2

### Patch Changes

- 012a86e: Arregla un bug de empaquetado: `index.ts` no re-exportaba `formato.ts`, así
  que `formatearImporteExacto` quedaba inalcanzable para quien consume el
  paquete publicado (`formatearPlata`, que sí es pública, la usa por dentro,
  pero no la expone). Agrega `export * from "./formato.js"` al index y un test
  que la importa desde ahí.

## 0.2.1

### Patch Changes

- Agrega la condición `"default"` a cada entrada de `exports` (raíz y subpaths,
  como `/drizzle` o `/next`), justo después de `"import"`.
  
  Sin esto, `drizzle-kit generate` (y cualquier otro loader que resuelva vía
  CJS, incluido `require(esm)` de Node ≥22) fallaba con
  `ERR_PACKAGE_PATH_NOT_EXPORTED` al importar, por ejemplo,
  `@mafesoftware/tenant/drizzle` desde un `schema.ts`: el `exports` map solo
  tenía condiciones `types` e `import`, y ninguna que un resolver CJS supiera
  interpretar.
  
  `"default"` apunta al mismo archivo `.js` que `"import"` — el paquete sigue
  siendo ESM puro, no se agrega ningún build CJS — pero al ser la condición de
  más baja prioridad, un loader que no entiende `"import"` cae en ella igual.
  
  Sin cambios de API pública.

## 0.2.0

### Minor Changes

- 1050024: Agrega la API 0.2 en `bigint`, aditiva a la 0.1 (que queda `@deprecated` pero
  sigue funcionando):
  
  - `Importe` (`{ centavos: bigint; moneda: Moneda }`) y `Moneda` (`"ARS" |
    "USD" | "EUR"`).
  - `redondearComercial(num, den)`: redondeo medio hacia arriba, alejándose de
    cero, en `bigint` puro.
  - `aplicarFactor(centavos, factor)`: factores decimales de hasta 8 decimales
    (spec 02 §3.2), sin punto flotante.
  - `factorEntre(valorRef, valorBase)`: la razón exacta entre dos valores de
    índice (acepta cualquier cantidad de decimales en la entrada, a diferencia
    de `aplicarFactor`), redondeada comercial a 8 decimales (`bigint` puro).
    Los índices son positivos: tira `ErrorPlata` (`indice_invalido`) si
    `valorRef`/`valorBase` no son mayores a 0, o no son un decimal válido.
  - `repartirPorMayorResto(total, pesos)`: reparto por mayor resto (pesos como
    `bigint | number | string`, incluida notación exponencial en los
    `number`), sin límite de decimales; **empate en el resto → gana el peso
    más grande; empate también en el peso → el índice más bajo** (spec 02
    §1). Un `-0` cuenta como cero, no como negativo. Tira `ErrorPlata` con
    lista vacía, un peso negativo o todos los pesos en cero.
  - `convertir(importe, moneda, tc)`: `tc` tiene que ser mayor a 0 (si no,
    `ErrorPlata` `tc_no_positivo`), y convertir a la misma moneda de origen
    exige `tc === "1"` (si no, `ErrorPlata` `tc_identidad`). El round trip
    (`convertir` ida y vuelta) cae dentro de ±1 centavo **solo** cuando el TC
    y su inverso son recíprocos exactos y se arranca en la moneda fuerte — no
    es una garantía general con dos cotizaciones cargadas por separado.
  - `sumar(...importes)` (tira `ErrorPlata` si se mezclan monedas, o si se
    llama sin importes).
  - `parsearImporte(texto, opciones?)`: nunca tira, devuelve `{ ok, centavos }`
    o `{ ok, error }`. Se llama distinto de `parsearPlata` (0.1) porque la
    forma del resultado cambió de raíz. Formato es-AR **estricto** por
    defecto: un punto SIEMPRE es separador de miles (debe agrupar de a 3
    dígitos exactos; `"1.50"`/`"1234.56"` son inválidos) — `opciones.
    decimalConPunto: true` habilita la convención en inglés (responsabilidad
    de quien llama: en ese modo `"1.000"` es 1 peso, no mil). Solo tolera
    dígitos, un `-` inicial, `.`, `,`, espacios y símbolos/códigos de moneda
    (`$`, `US$`, `U$S`, `ARS`, `USD`, `EUR`, `€`) — como mucho UNO en total, y
    únicamente como prefijo o sufijo alrededor del número, nunca metidos
    adentro de los dígitos ni repetidos: `"1e3"`, `"(500)"`, `"1$2"`, `"12 ARS
    34"` y `"$$5"` son inválidos, no se leen a pedazos ni con dos monedas a la
    vez. El escaneo es de una sola pasada, O(n) (sin la regex con `\s*`
    adyacentes que puede backtrackear cuadrático sobre corridas largas de
    espacio), y además rechaza de entrada textos de más de
    `LONGITUD_MAXIMA_IMPORTE` (64) caracteres.
  - `formatearPlata` ahora también acepta `Importe | bigint` (sobrecarga sobre
    la firma 0.1 en `Centavos`), con aritmética `bigint` exacta más allá de
    `Number.MAX_SAFE_INTEGER` centavos y agrupamiento/separadores del locale
    real (vía un string decimal exacto a `Intl.NumberFormat`, no una
    reimplementación a mano que asume grupos de a 3 en todos lados).
    `opciones.moneda` no tiene efecto cuando se pasa un `Importe` (la moneda la
    trae el propio importe).
  - `ErrorPlata` / `CodigoErrorPlata`, para las condiciones de arriba que son
    un bug de quien llama, no un dato de usuario (agrega `tc_no_positivo`,
    `tc_identidad` e `indice_invalido`).

### Patch Changes

- a8db00c: Agrega la LICENSE (copia de la de la raíz, MIT) a cada `packages/*` que
  todavía no la tenía en su checkout — `arca-ar`/`correo`/`mercadopago-ar` ya
  la tenían. `npm`/`bun pm pack` ya subían la LICENSE de la raíz al tarball
  publicado aunque no estuviera acá (confirmado con un pack en seco), pero
  `tests/estructura.test.ts` ahora también exige que cada paquete la tenga en
  su checkout, y `scripts/nuevo-paquete.ts` la copia sola para los paquetes
  nuevos.
- 7d3a1fd: Aclara en el JSDoc de `LONGITUD_MAXIMA_IMPORTE` y en el README que
  `parsearImporte` cuenta el texto CRUDO (espacios u otro whitespace
  alrededor incluidos) contra ese máximo, sin recortarlo antes. Solo
  documentación — el comportamiento ya era ese.
- a8db00c: Agrega `"sideEffects": false` a los paquetes puros (sin efectos de
  importación: no mutan globals, no ejecutan nada al cargarlos) — permite que
  un bundler haga tree-shaking real de las funciones no usadas en vez de
  asumir, por las dudas, que todo el módulo hace falta.

## 0.1.0

Plata en centavos, con parseo y formato argentino: conversión (`aCentavos`,
`aPesos`), formato (`formatearPlata`, `plataARS`), parseo (`parsearPlata`,
`parsearNumeroAR`, `parsearPorcentaje`, `parsearCantidad`,
`pesosParaPlanilla`) y reparto sin perder ni inventar un centavo
(`repartirCentavos`, `aplicarPorcentaje`, `sumarCentavos`). Sin dependencias.
