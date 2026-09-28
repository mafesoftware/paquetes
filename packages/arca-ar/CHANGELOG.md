# Changelog

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

Consulta al padrón por CUIT (`consultarPadron`, `ticketDePadron`,
`condicionDesdePadron`) y `consultarComprobante` (FECompConsultar) para
verificar un comprobante ya emitido contra ARCA.

## 0.1.1

Las notas de crédito (`CbtesAsoc`) nombran a qué factura corrigen.

## 0.1.0

WSAA con firma CMS hecha a mano (verificada contra `openssl cms -verify`),
WSFEv1 (`solicitarCae`, `ultimoAutorizado`, `estadoDelServicio`) y la
derivación de la letra del comprobante (`letraPara`, `tipoComprobante`).
