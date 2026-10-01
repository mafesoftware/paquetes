/**
 * Retenciones impositivas argentinas: Ganancias (RG 830, mínimo no sujeto
 * acumulado o escala progresiva), IVA (sobre el IVA del comprobante, no el
 * neto), SUSS construcción (con/sin mano de obra) e IIBB (padrón ARBA/AGIP
 * o Convenio Multilateral), exclusiones/certificados de no retención, y el
 * formateo de ancho fijo/delimitado que usan las exportaciones a los
 * organismos (SICORE, SIRE/F.2004, ARBA, AGIP).
 *
 * Núcleo puro: sin DB, sin framework, sin `process.env`. Plata en centavos
 * `bigint`; cantidades/alícuotas como `string` decimal (nunca `number`,
 * para no perder precisión en el redondeo final). Depende de
 * `@mafesoftware/plata-ar` (`redondearComercial`) para la única operación
 * de redondeo de todo el paquete — nunca reimplementada acá.
 *
 * - `tipos.ts`: los tipos compartidos por todo lo demás (`Regimen`,
 *   `Jurisdiccion`, `Exclusion`, `TablaGanancias`, `FilaPadron`,
 *   `CalculoRetencion`, ...).
 * - `calculo.ts`: helpers compartidos por los cuatro cálculos —
 *   `aplicarPorcentaje` (exacto en `bigint`, redondeo SOLO al final),
 *   `aplicarExclusion`, `formatearPesos`, `netoDelPago`.
 * - `ganancias.ts` / `iva.ts` / `suss.ts` / `iibb.ts`: `retencionGanancias`,
 *   `retencionIva`, `retencionSuss`, `retencionIibb` — un cálculo puro por
 *   régimen, cada uno recibe ya resuelto todo lo que necesita (tabla,
 *   acumulado del mes, exclusión vigente, padrón) y devuelve un
 *   `CalculoRetencion` con una `explicacion` legible.
 * - `exclusiones.ts`: `exclusionVigente` — filtra un listado de
 *   certificados por régimen + vigencia inclusive.
 * - `jurisdiccion.ts`: `jurisdiccionDeProvincia` — mapea una provincia en
 *   texto libre a `"ARBA" | "AGIP" | null`.
 * - `padron.ts`: `parsearLineaArba`/`parsearLineaAgip` (parsing del
 *   archivo que publican ambos organismos) y `elegirAlicuotaVigente`
 *   (override de organización + vigencia más reciente).
 * - `serializacion.ts`: `serializarTablaGanancias`/
 *   `deserializarTablaGanancias` — frontera `bigint` ↔ `string` para
 *   persistir una `TablaGanancias` en una columna `jsonb`.
 * - `formato.ts`: building blocks de formateo fiscal (ancho fijo,
 *   delimitado, fechas, CUIT, importes) compartidos por los exportadores a
 *   SICORE/SIRE/ARBA/AGIP — el layout campo a campo de cada archivo es de
 *   la app, este paquete no lo conoce.
 *
 * `/drizzle` (peerDependency opcional `drizzle-orm`) trae `tablaPadronIibb`
 * y `tablaExclusiones` — factories de tabla genéricas, parametrizadas por
 * la columna de tenant (mismo patrón que `@mafesoftware/outbox`/
 * `@mafesoftware/numeradores`). El resto de la configuración de regímenes
 * (catálogo global vs. override por organización, FKs a proveedores/
 * razones sociales, certificados numerados, acumulados mensuales) es
 * específico de cada app y queda fuera de este paquete.
 */
export type {
  CalculoRetencion,
  EscalaTramo,
  EscalaTramoSerializada,
  ErrorImportacionPadron,
  Exclusion,
  FilaPadron,
  FilaPadronConOrigen,
  Jurisdiccion,
  Regimen,
  TablaGanancias,
  TablaGananciasSerializada,
  TipoPadron,
} from "./tipos.js";

export { max0, aplicarPorcentaje, aplicarExclusion, formatearPesos, netoDelPago } from "./calculo.js";

export { exclusionVigente } from "./exclusiones.js";

export { retencionGanancias, type ParametrosRetencionGanancias } from "./ganancias.js";
export { retencionIva, type ParametrosRetencionIva } from "./iva.js";
export { retencionSuss, type ParametrosRetencionSuss } from "./suss.js";
export { retencionIibb, type ParametrosRetencionIibb } from "./iibb.js";

export { jurisdiccionDeProvincia } from "./jurisdiccion.js";

export {
  parsearLineaArba,
  parsearLineaAgip,
  elegirAlicuotaVigente,
  type ResultadoParseoArba,
  type ResultadoParseoAgip,
} from "./padron.js";

export { serializarTablaGanancias, deserializarTablaGanancias } from "./serializacion.js";

export {
  anchoFijo,
  numeroFijo,
  soloDigitos,
  cuitSinGuiones,
  cuitConGuiones,
  fechaCompacta,
  fechaBarras,
  importeSinComaAncho,
  importeConComa,
  porcentajeConComa,
  alicuotaCorta,
  armarContenido,
  filaDelimitada,
  aBufferLatin1,
} from "./formato.js";
