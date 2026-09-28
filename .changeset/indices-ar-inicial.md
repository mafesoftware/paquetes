---
"@mafesoftware/indices-ar": minor
---

Primer release del paquete (0.1.0): índices de ajuste argentinos (CAC, ICC,
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
  modalidades provisorio/definitivo.
- `ModalidadAjuste` (`"disponible" | "provisorio" | "definitivo"`) y
  `accionAlPublicarDefinitivo(modalidad, cuotaCobrada)` ->
  `"nada" | "recalcular" | "diferencia_proxima_cuota" |
  "documento_ajuste"`: una cuota no cobrada siempre se recalcula; una
  cobrada depende de la modalidad.
- `aplicarTope({ ajusteAcumuladoPct, topePct, ajusteNuevo, montoBase })`:
  cuánto de un ajuste nuevo cabe antes de superar el tope acumulado, y
  cuánto queda "absorbido" — solo limita hacia arriba, un ajuste negativo
  pasa entero. `soloPositivo(ajuste)`.
- `valorPolinomica(componentes)`: `Σ peso_i × (actual_i / base_i)`, exacto
  en `bigint` de punta a punta (cada razón vía `factorEntre`, la
  ponderación y la suma en aritmética entera exacta, redondeo comercial a
  8 decimales una sola vez al final). Tira `ErrorIndices
  ("pesos_no_suman_uno")` si los pesos no suman 1 (±1e-8).
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
    del tenant si existe, si no el global.
- `/fuentes`: `leerUvaCer({ fetch, desde?, hasta? })` (BCRA, API pública de
  estadísticas monetarias v4.0, ids 31/30) y `leerCotizaciones({ fetch })`
  (dolarapi.com, filtrado a oficial/blue/mep/ccl) — `fetch` siempre
  inyectado, ninguna de las dos tira: devuelven `{ ok: true; valores } |
  { ok: false; categoria: "red" | "http" | "formato" }`.
