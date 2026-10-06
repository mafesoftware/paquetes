# Changelog

## 0.1.2

### Patch Changes

- Updated dependencies [0aded29]
- Updated dependencies [0aded29]
  - @mafesoftware/fechas-ar@0.3.0
  - @mafesoftware/plata-ar@0.3.0

## 0.1.1

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
- Updated dependencies
  - @mafesoftware/fechas-ar@0.2.1
  - @mafesoftware/plata-ar@0.2.1

## 0.1.0

### Minor Changes

- 876f2da: Primer release del paquete (0.1.0): índices de ajuste argentinos (CAC, ICC,
  UVA, CER, IPC, ICL) — spec 02 §3.
  
  - `calcularAjuste(montoBase, valorBase, valorRef)`: factor de 8 decimales
    (`factorEntre` de `plata-ar`), monto ajustado (`aplicarFactor`, redondeo
    comercial al centavo) y el ajuste (`montoAjustado - montoBase`, negativo
    si hay deflación). No reimplementa la aritmética de factores.
  - `periodoReferencia(vencimiento, regla, ultimoPublicado)`: el período que
    corresponde usar según la regla del contrato — `{ tipo: "desfase";
    meses }` (vencimiento menos `meses`, vía `periodoDe`/`sumarPeriodos` de
    `fechas-ar`) o `{ tipo: "ultimo_publicado" }` (lo que se le pase,
    incluido `null` si todavía no se publicó nada).
  - `diferenciaDeAjuste(montoBase, valorBase, valorUsado, valorDefinitivo)`:
    la diferencia entre ajustar con el valor definitivo y con el usado —
    modalidades provisorio/definitivo. Solo para el caso SIN tope; con tope,
    usar `diferenciaDeAjusteConTope` (más abajo).
  - `ModalidadAjuste` (`"disponible" | "provisorio" | "definitivo"`) y
    `accionAlPublicarDefinitivo(modalidad, cuotaCobrada)` ->
    `"nada" | "recalcular" | "diferencia_proxima_cuota" |
    "documento_ajuste"`: una cuota no cobrada siempre se recalcula; una
    cobrada depende de la modalidad.
  - `ajusteConTope({ montoBase, valorBase, valorRef, topePct, soloPositivo? })`:
    el ajuste completo (`calcularAjuste`) YA capado — el tope limita el ajuste
    TOTAL de la cuota (spec 02 §3.2, ruling del controlador), no un acumulado
    aparte por período. `soloPositivo: true` capa además una deflación a 0.
    Devuelve `{ factor, ajusteSinTope, ajusteAplicado, absorbido }`.
    `diferenciaDeAjusteConTope({ montoBase, valorBase, valorUsado,
    valorDefinitivo, topePct, soloPositivo? })`: `ajusteConTope(definitivo)
    .ajusteAplicado - ajusteConTope(usado).ajusteAplicado` — cada lado capado
    ANTES de restar, para que un contrato con tope no calcule un crédito o
    cargo que el tope ya había evitado en su momento. (Reemplaza al `aplicarTope`
    original: ese tomaba `ajusteAcumuladoPct` + `ajusteNuevo` sueltos y dejaba
    pasar entera cualquier corrección negativa sin mirar contra qué venía
    capada la cuota anterior — daba créditos que el cliente no debía recibir.)
  - `valorPolinomica(componentes)`: `Σ peso_i × (actual_i / base_i)`, exacto
    en `bigint` de punta a punta (nunca `number`) pero con DOS redondeos: cada
    razón vía `factorEntre` ya redondea comercial a 8 decimales por
    componente, y la suma ponderada (aritmética entera exacta) se redondea
    comercial una segunda vez al final — error total acotado en `≤ ~1e-8`, no
    cero. Tira `ErrorIndices("pesos_no_suman_uno")` si los pesos no suman 1
    (±1e-8).
  - `puntosIndice(saldo, valorBase)` / `saldoDesdePuntos(puntos, valorActual)`:
    saldo de un boleto en unidades índice, y su inverso.
  - `ErrorIndices` / `CodigoErrorIndices`. Los errores de `plata-ar`
    (`ErrorPlata`) y `fechas-ar` (`ErrorFecha`) se propagan tal cual cuando
    la validación es de esos paquetes.
  - `/drizzle` (requiere `drizzle-orm >=0.45 <0.46`, peerDependency
    opcional):
    - `tablaIndices({ nombre?, columnasExtra? })`: catálogo global —
      `codigo` (PK), `nombre`, `fuente`, `frecuencia`.
    - `tablaValoresIndice({ tenant?, nombre?, columnasExtra? })`: valor
      mensual por índice, con columna de tenant **NULLABLE** (`NULL` = valor
      global de la plataforma; un id concreto = override auditado de esa
      organización). Dos índices únicos PARCIALES —uno por `(tenant, indice,
      periodo) WHERE tenant IS NOT NULL`, otro por `(indice, periodo) WHERE
      tenant IS NULL`— porque un único índice normal no alcanza a impedir
      dos filas globales del mismo período (Postgres no trata dos `NULL`
      como iguales).
    - `tablaCotizaciones({ tenant?, nombre?, columnasExtra? })`: misma
      convención de tenant nullable, sobre `(fecha, fuente)`.
    - `valorVigente(db, tabla, { tenantId?, indice, periodo })`: el override
      del tenant si existe, si no el global. Asume la forma de resultado de
      `node-postgres`/`neon-serverless` (`{ rows: [...] }`), documentado en
      el README.
  - `/fuentes`: `leerUvaCer({ fetch, desde?, hasta? })` (BCRA, API pública de
    estadísticas monetarias v4.0, ids 31/30 — sigue automáticamente la
    paginación de 1000 filas de `metadata.resultset`) y `leerCotizaciones({
    fetch })` (dolarapi.com, filtrado a oficial/blue/mep/ccl) — `fetch`
    siempre inyectado, ninguna de las dos tira: devuelven `{ ok: true;
    valores } | { ok: false; categoria: "red" | "http" | "formato" }`.

### Patch Changes

- a8db00c: Agrega la LICENSE (copia de la de la raíz, MIT) a cada `packages/*` que
  todavía no la tenía en su checkout — `arca-ar`/`correo`/`mercadopago-ar` ya
  la tenían. `npm`/`bun pm pack` ya subían la LICENSE de la raíz al tarball
  publicado aunque no estuviera acá (confirmado con un pack en seco), pero
  `tests/estructura.test.ts` ahora también exige que cada paquete la tenga en
  su checkout, y `scripts/nuevo-paquete.ts` la copia sola para los paquetes
  nuevos.
- a8db00c: Agrega `"sideEffects": false` a los paquetes puros (sin efectos de
  importación: no mutan globals, no ejecutan nada al cargarlos) — permite que
  un bundler haga tree-shaking real de las funciones no usadas en vez de
  asumir, por las dudas, que todo el módulo hace falta.
- a8db00c: Las dependencias internas del monorepo pasan de `"workspace:*"` a
  `"workspace:^"`. `scripts/reescribir-workspace.ts` (que corre `bun run
  release` antes de `changeset publish`) ya sabía convertir las dos formas —
  `"workspace:*"` a la versión exacta, `"workspace:^"` a `"^" + la versión —
  pero `"workspace:*"` publicado como versión exacta fija el internal
  dependency a un único patch, y cada bump de `plata-ar`/`fechas-ar`/`tenant`
  obligaría a republicar TODO lo que depende de ellos aunque el cambio sea
  compatible. Con `"workspace:^"`, el paquete publicado queda con
  `"^x.y.z"`, que permite actualizaciones compatibles de la dependencia sin
  forzar una nueva publicación del que la consume.
  
  Sin cambios de comportamiento: `bun run lint:paquetes` (el chequeo de
  `bun pm pack` + reescritura) y `tests/reescribir-workspace.test.ts` ya
  cubrían este caso.
- Updated dependencies [f05e1fc]
- Updated dependencies [a8db00c]
- Updated dependencies [1050024]
- Updated dependencies [7d3a1fd]
- Updated dependencies [a8db00c]
  - @mafesoftware/fechas-ar@0.2.0
  - @mafesoftware/plata-ar@0.2.0

## 0.0.0

Paquete generado con `scripts/nuevo-paquete.ts`.
