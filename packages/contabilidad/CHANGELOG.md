# Changelog

## 0.1.0

### Minor Changes

- 139df4b: Primer release del paquete (0.1.0): motor de contabilidad por partida doble
  para los productos de MAFE Software.
  
  - **Plan de cuentas** (`validarArbol`, `crearPlanDesdePlantilla`): valida la
    forma de un árbol de cuentas (código duplicado, imputable con hijas,
    naturaleza heredada) y arma un plan nuevo a partir de una plantilla ya
    cargada.
  - **Asientos** (`balancea`, `espejo`): la forma de un asiento de partida
    doble, si Σ debe === Σ haber, y el contraasiento de una anulación.
  - **Mapeos** (`CLAVE`, `resolverCuenta`, `calcularFaltantes`,
    `siguienteCodigoSubcuenta`): vocabulario de claves de mapeo (caja, tipo de
    operación, IVA, retenciones...), resolución contra el mapa vigente sin
    tirar (devuelve el faltante) y el motor de una pantalla de "mapeos
    pendientes".
  - **Períodos** (`periodosMensualesDe`, `exigirPeriodoAbierto`): los 12
    períodos mensuales de un ejercicio y el contrato central (`tira
    ErrorPeriodoCerrado`) para cualquier escritura con fecha contable.
  - **Refundición de cierre** (`refundicionDe`) y **ajuste por inflación RT 6**
    (`coeficienteRT6`, `ajustePorRT6`): cancelación de cuentas de resultado
    contra el resultado del ejercicio, y reexpresión de rubros no monetarios y
    de patrimonio neto con su contrapartida de REI/RECPAM.
  - **Reportes** (`saldoDeCuenta`, `totalesSumasYSaldos`,
    `agruparPorNaturaleza`, `balanceCuadra`, `evaluarAgrupacion`,
    `estadoResultadosDeSumas`, `saldoCorrido`, `totalPorProyecto`,
    `calcularProporcionAB`): la aritmética de sumas y saldos, balance general,
    estado de resultados, mayor y reparto por dimensión/libro, sobre totales
    ya agregados por el consumidor.
  
  **Núcleo puro** (regla 1 de diseño del monorepo): sin base de datos, sin
  framework, sin `process.env`. Plata en `bigint` (centavos), fechas como
  `string` `"YYYY-MM-DD"`. Usa `@mafesoftware/plata-ar` para el redondeo
  comercial (reparto por mayor resto, `factorEntre`/`aplicarFactor`).
  
  Extraído de Obriq (`src/lib/dominio/contabilidad/`), donde ya era núcleo
  puro por diseño (sin `@/db`, `next` ni nada de la app). Quedó afuera
  `documentos.ts`: vocabulario de tipos de documento propio de Obriq, no
  lógica del motor contable en sí.

## 0.1.0

Primer release del paquete: motor de contabilidad por partida doble (plan
de cuentas, asientos balanceados, mapeos, libros diario/mayor/sumas y
saldos/balance/resultados, períodos, refundición de cierre y ajuste por
inflación RT 6).

Extraído de Obriq (`src/lib/dominio/contabilidad/`).
