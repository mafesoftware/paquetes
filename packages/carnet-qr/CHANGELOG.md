# Changelog

## 0.1.1

### Patch Changes

- a8db00c: Agrega la LICENSE (copia de la de la raíz, MIT) a cada `packages/*` que
  todavía no la tenía en su checkout — `arca-ar`/`correo`/`mercadopago-ar` ya
  la tenían. `npm`/`bun pm pack` ya subían la LICENSE de la raíz al tarball
  publicado aunque no estuviera acá (confirmado con un pack en seco), pero
  `tests/estructura.test.ts` ahora también exige que cada paquete la tenga en
  su checkout, y `scripts/nuevo-paquete.ts` la copia sola para los paquetes
  nuevos.

## 0.1.0

Carnet digital firmado con Ed25519, verificable offline
(`generarClaves`, `emitirCarnet`, `verificarCarnet`), con revocación por
versión y comparación en tiempo constante (`compararEnTiempoConstante`). Sin
dependencias fuera de `node:crypto`.
