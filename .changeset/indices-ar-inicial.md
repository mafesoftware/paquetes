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
