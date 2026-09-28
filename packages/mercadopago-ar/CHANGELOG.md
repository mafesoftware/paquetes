# Changelog

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

## 0.1.0

Integración de Mercado Pago para Argentina: Checkout Pro (`crearPreferencia`
con comisión opcional), OAuth de marketplace (`iniciarVinculacion`,
`resolverVinculacion`, `canjearCodigo`, `refrescarToken`), verificación de la
firma del webhook (`verificarFirmaWebhook`), lectura normalizada del aviso
(`leerNotificacion`) y el orquestador idempotente
(`procesarNotificacionDePago`, `reconciliarPago`). Adaptador `/next` con la
ruta del webhook y el andamio del OAuth.
