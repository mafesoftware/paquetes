---
"@mafesoftware/aprobaciones": minor
---

Primer release del paquete (0.1.0): motor puro de aprobaciones por niveles,
extraído de Obriq (`src/lib/dominio/aprobaciones/circuito.ts`).

- **`elegirCircuito(circuitos, documento)`**: el circuito activo que aplica
  a un documento, entre varios candidatos de su mismo `tipo` — el más
  específico (más condiciones de monto/proyecto/rubro/proveedor no nulas)
  gana; empate → mayor `montoDesde`; empate → mayor `version`. Ninguno
  coincide → `null` (no requiere aprobación).
- **`estadoSolicitud(snapshot, votos, documento)`**: en qué nivel está una
  solicitud dado el snapshot del circuito (congelado al abrirla) y los
  votos emitidos — secuencial por nivel, un nivel se completa al llegar a
  su `minimo` de votos "aprobar", un solo "rechazar" en cualquier nivel
  rechaza toda la solicitud. Auto-aprobación bloqueada:
  `documento.creadoPor` nunca puede votar su propia solicitud cuando el
  circuito tiene `creadorPuedeAprobar: false`, aunque figure entre los
  habilitados del nivel.

**Núcleo puro** (regla 1 de diseño del monorepo): sin DB ni framework, sin
`process.env`. Montos en centavos (`bigint`). `tipo` es `string` libre —
Obriq define un enum cerrado de documentos inmobiliarios en su propia
capa de dominio; otro producto define el suyo sin tocar este paquete.

Lo que queda fuera (ver README, "Lo que este paquete NO hace"): la
persistencia (tablas de circuitos/niveles/solicitudes/votos, abrir una
solicitud, registrar un voto en transacción) es lógica atada al schema de
cada app — no hay una parte genérica de eso para extraer, a diferencia de
`@mafesoftware/numeradores` u `@mafesoftware/outbox`.
