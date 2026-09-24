# @mafesoftware/permisos

Presets de rol y modulos por plan, con excepciones. Puro.

Parte de la familia de paquetes de MAFE Software: sin dependencias de framework,
sin ORM, y **puros** salvo donde se indique. Todo lo que sale a la red acepta un
`fetch` inyectable, así que los tests corren sin red.

```bash
bun add @mafesoftware/permisos
```

La documentación de cada función está en `src/index.ts`, con **el motivo de
cada decisión** al lado. Los tests (`tests/`) son la otra mitad de la
documentación: cada uno dice qué bug evita.

## API

### `crearSistema({ claves, presets })`

Declara un sistema de presets con excepciones (sirve igual para roles de
usuario que para módulos contratados por plan).

```ts
import { crearSistema } from "@mafesoftware/permisos";

export const ROLES = crearSistema({
  claves: ["socios.ver", "socios.editar", "cobranzas.cobrar"] as const,
  presets: {
    duenio: "todas",
    tesoreria: ["socios.ver", "cobranzas.cobrar"],
    porteria: ["socios.ver"],
  },
});

ROLES.tiene("porteria", { "socios.editar": true }, "socios.editar"); // true (excepción concede)
ROLES.tiene("duenio", { "cobranzas.cobrar": false }, "cobranzas.cobrar"); // false (excepción quita)
ROLES.efectivas("tesoreria", null); // Set { "socios.ver", "cobranzas.cobrar" }
ROLES.delPreset("porteria"); // Set { "socios.ver" }
ROLES.minimas("tesoreria", ["socios.ver"]); // { "cobranzas.cobrar": false }
ROLES.limpiar("porteria", { "socios.ver": true }); // {} (no dice nada distinto del preset)
ROLES.esClave("socios.ver"); // true
```

### `leerExcepciones(crudo, esClave)`

Lee un mapa de excepciones que vino de la base (`jsonb`) o de un formulario,
descartando cualquier valor que no sea booleano (un `"false"` de texto es
`true` en JavaScript, y coercionarlo concedería el permiso).

```ts
import { leerExcepciones } from "@mafesoftware/permisos";

leerExcepciones({ "socios.ver": true, "socios.editar": "false" }, ROLES.esClave);
// { "socios.ver": true }  (la clave con basura se descarta, no se coerciona)
```

## Probar

```bash
bun test
```
