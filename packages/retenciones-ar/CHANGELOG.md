# Changelog

## 0.2.1

### Patch Changes

- Updated dependencies [0aded29]
  - @mafesoftware/plata-ar@0.3.0

## 0.2.0

### Minor Changes

- 2bebd4c: Primer release del paquete (0.1.0): retenciones impositivas argentinas —
  **Ganancias** (RG 830, mínimo no sujeto acumulado o escala progresiva),
  **IVA** (sobre el IVA del comprobante, no el neto), **SUSS** construcción
  (con/sin mano de obra) e **IIBB** (padrón ARBA/AGIP o Convenio
  Multilateral), **exclusiones**/certificados de no retención, y el
  **formateo** de ancho fijo/delimitado que usan las exportaciones a los
  organismos (SICORE, SIRE/F.2004, ARBA, AGIP).
  
  - **`retencionGanancias`/`retencionIva`/`retencionSuss`/`retencionIibb`**:
    un cálculo puro por régimen, cada uno recibe ya resuelto todo lo que
    necesita (tabla, acumulado del mes, exclusión vigente, padrón) y devuelve
    un `CalculoRetencion` con una `explicacion` legible.
  - **`aplicarPorcentaje`/`aplicarExclusion`/`netoDelPago`**: helpers
    compartidos — porcentaje exacto en `bigint` (fracción, redondeo SOLO al
    final con `redondearComercial` de `@mafesoftware/plata-ar`, nunca
    reimplementado).
  - **`exclusionVigente`**: filtra certificados de no retención por régimen +
    vigencia inclusive.
  - **`jurisdiccionDeProvincia`/`parsearLineaArba`/`parsearLineaAgip`/
    `elegirAlicuotaVigente`**: mapeo de provincia a jurisdicción y parsing del
    padrón de IIBB que publican ARBA/AGIP — nunca tiran ante una línea
    malformada.
  - **`serializarTablaGanancias`/`deserializarTablaGanancias`**: frontera
    `bigint` ↔ `string` para persistir una tabla de Ganancias en `jsonb`.
  - **`anchoFijo`/`numeroFijo`/`cuitConGuiones`/`fechaCompacta`/
    `importeConComa`/...**: building blocks de formateo fiscal compartidos
    por los cuatro exportadores.
  - **`/drizzle`** (peerDependency opcional `drizzle-orm`): `tablaPadronIibb`/
    `tablaExclusiones`, dos factories de tabla genéricas parametrizadas por la
    columna de tenant — mismo patrón que `@mafesoftware/outbox`/
    `@mafesoftware/numeradores`.
  
  **Núcleo puro** (regla 1 de diseño del monorepo): sin DB, sin framework, sin
  `process.env`. Plata en centavos `bigint`; cantidades/alícuotas como
  `string` decimal, nunca `number`.
  
  Extraído de Obriq (`src/lib/dominio/retenciones/`), donde ya era núcleo puro
  por diseño (sin `@/db`, `next` ni nada de la app).

## 0.1.0

Primer release del paquete: retenciones impositivas argentinas — Ganancias
(RG 830, mínimo no sujeto acumulado o escala), IVA (sobre el IVA del
comprobante), SUSS construcción (con/sin mano de obra) e IIBB (padrón
ARBA/AGIP o Convenio Multilateral), exclusiones/certificados de no
retención, y el formateo de ancho fijo/delimitado que usan las
exportaciones SICORE/SIRE/ARBA/AGIP. `/drizzle` (peerDependency opcional)
trae `tablaPadronIibb`/`tablaExclusiones`.

Extraído de Obriq (`src/lib/dominio/retenciones/`), donde ya era núcleo
puro por diseño (sin `@/db`, `next` ni nada de la app).
