/**
 * Motor de aprobaciones: circuitos versionados, niveles con mínimo de votos
 * por nivel, estado de una solicitud dados sus votos, y auto-aprobación
 * bloqueada — extraído de Obriq (`src/lib/dominio/aprobaciones/circuito.ts`)
 * y generalizado para cualquier producto que necesite un flujo de
 * aprobación por niveles sobre documentos propios.
 *
 * Núcleo puro: sin DB ni framework. `elegirCircuito` decide qué circuito
 * (de los activos, de un mismo `tipo`) aplica a un documento dado; `tipo` es
 * `string` libre — cada producto define los suyos (`"orden_compra"`,
 * `"reembolso"`, `"publicacion"`...) sin tocar este paquete.
 * `estadoSolicitud` calcula, dado el circuito (snapshot) y los votos
 * emitidos, en qué nivel está la solicitud, si ya está completa o
 * rechazada, y si un usuario puede votar ahora mismo.
 */
export {
  elegirCircuito,
  estadoSolicitud,
  type CondicionesCircuito,
  type NivelCircuito,
  type Circuito,
  type DocAprobable,
  type Voto,
  type EstadoSolicitud,
} from './circuito.js';
