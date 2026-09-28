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

### Minor Changes

- d271414: Primer release del paquete (0.1.0): CUIT/CUIL, DNI, CBU/CVU, alias y
  teléfonos argentinos. Puro, sin dependencias.
  
  - `validarCuit(valor)` / `formatearCuit(valor)`: 11 dígitos, prefijo
    conocido (20/23/24/27 persona, 30/33/34 empresa) y dígito verificador por
    el algoritmo de ARCA (pesos 5,4,3,2,7,6,5,4,3,2 módulo 11). Documenta y
    prueba el caso del dígito verificador 10 (regla 23/33): para algunos DNI
    el algoritmo da DV=10 bajo el prefijo natural (20 varón, 27 mujer), que no
    es representable en un solo dígito — ARCA lo resuelve en la práctica
    reasignando el prefijo a 23, con el DV que el mismo algoritmo da para ese
    prefijo (no es una tabla arbitraria).
  - `validarDni(valor)`: 7 u 8 dígitos, acepta puntos de miles; rechaza el 0 y
    cualquier valor con cero a la izquierda.
  - `validarCbu(valor)` / `validarCvu(valor)`: 22 dígitos en dos bloques
    (banco+sucursal+DV1, dígitos 1-8; cuenta+DV2, dígitos 9-22), cada uno con
    su propio dígito verificador módulo 10. `validarCbu` rechaza los que
    empiecen con "000" (son CVU) y `validarCvu` rechaza los que no, cada uno
    con un motivo que apunta a la función correcta. Probado también contra un
    CBU real (no solo fixtures sintéticas): el que la Universidad Católica de
    Córdoba publica para donaciones, https://ucc.edu.ar/desarrollo/desarrollo-dona/.
  - `validarAlias(valor)`: 6 a 20 caracteres `[a-z0-9.-]`, sin distinguir
    mayúsculas de minúsculas.
  - `enmascarar(valor, visibles = 4)`: deja visibles los últimos `visibles`
    caracteres y reemplaza el resto por `"*"`.
  - `telefonoAE164(valor)` / `aWhatsApp(valor)`: normaliza un celular
    argentino a E.164 (`"+549"` + área + abonado), entendiendo "+54", "9", "0"
    y "15" en cualquier combinación de espacios, guiones o paréntesis, con una
    heurística documentada para el largo del código de área (2 a 4 dígitos,
    sin tabla de códigos) en vez de una lista hardcodeada. `null` cuando no se
    puede determinar.
  - `CONDICIONES_IVA`: las condiciones frente al IVA más comunes, con el
    `idArca` de la tabla `FEParamGetCondicionIvaReceptor` del web service
    WSFEv1 de ARCA (1 Responsable Inscripto, 4 Exento, 5 Consumidor Final, 6
    Monotributo, 15 No Alcanzado). El campo queda opcional en el tipo a
    propósito: una condición futura cuyo id no se pueda verificar con certeza
    queda sin `idArca` en vez de con un valor adivinado.
  - Ninguna función tira: todas las de validación devuelven `{ ok, ... }`.
  - Property-based tests (fast-check): un CUIT armado con el DV calculado
    siempre valida y alterar cualquiera de sus 11 dígitos siempre lo
    invalida, para cada prefijo válido; lo mismo para CBU y CVU con sus 22
    dígitos. Los pesos usados (coprimos con el módulo en los dos algoritmos)
    hacen que la detección sea total — no hace falta acotar la propiedad a
    una clase "detectable" (documentado en `tests/propiedades.test.ts`).
- a8db00c: Renombra el campo `motivo` (el texto humano) a `mensaje` en el resultado de
  `validarCuit`/`validarDni`/`validarCbu`/`validarCvu`/`validarAlias` —
  `codigo` (el código de máquina) no cambia. Esto alinea a `documentos-ar` con
  `seguridad`/`tenant`/`carnet-qr`, donde `motivo` YA es el código de máquina;
  tener el mismo nombre de campo significando dos cosas distintas según el
  paquete era confuso, y corregirlo antes de la primera publicación es gratis.
  
  Antes de la primera publicación: sin consumidores externos afectados.

### Patch Changes

- a8db00c: Agrega la LICENSE (copia de la de la raíz, MIT) a cada `packages/*` que
  todavía no la tenía en su checkout — `arca-ar`/`correo`/`mercadopago-ar` ya
  la tenían. `npm`/`bun pm pack` ya subían la LICENSE de la raíz al tarball
  publicado aunque no estuviera acá (confirmado con un pack en seco), pero
  `tests/estructura.test.ts` ahora también exige que cada paquete la tenga en
  su checkout, y `scripts/nuevo-paquete.ts` la copia sola para los paquetes
  nuevos.
- a8db00c: Agrega `"sideEffects": false` a los paquetes puros (sin efectos de
  importación: no mutan globals, no ejecutan nada al cargarlos) — permite que
  un bundler haga tree-shaking real de las funciones no usadas en vez de
  asumir, por las dudas, que todo el módulo hace falta.

## 0.0.0

Paquete generado con `scripts/nuevo-paquete.ts`.
