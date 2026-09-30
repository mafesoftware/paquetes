---
"@mafesoftware/clientes": minor
---

Primer release del paquete (0.1.0): validación de documento (DNI/CUIT) y
normalización para detectar duplicados de clientes/prospectos, extraído de
Obriq (spec 10 §1.6/§1.7 — "DNI/CUIT único por organización, advertencia y
sugerencia de fusión").

- **`validarDocumentoCliente(tipo, valor)`**: valida y normaliza un DNI o
  un CUIT — compone `@mafesoftware/documentos-ar` para el dígito
  verificador, nunca lo reimplementa. Nunca tira: `{ ok: false, mensaje }`
  ante un documento inválido.
- **`normalizarTelefono`/`esMismoTelefono`**: comparación de teléfonos
  argentinos ignorando el código de país (`54`), el `9` de celular y el
  `0` de discado local, así `"+54 9 11 1234-5678"` y `"11 1234-5678"`
  normalizan igual. Dos teléfonos vacíos nunca "coinciden" entre sí.
- **`normalizarDni`/`normalizarEmail`**: normalización simple (solo
  dígitos; minúsculas sin espacios de borde) para comparar duplicados por
  esos campos.

**Núcleo puro** (regla 1 de diseño del monorepo): sin DB ni framework, sin
`process.env`. La fusión en sí (mover cuenta corriente/reservas/prospectos
del perdedor al ganador y archivarlo con un puntero) queda fuera de este
paquete — es lógica transaccional atada al schema de cada app, sin parte
pura para extraer; ver el README, sección "Lo que este paquete NO hace".
