-- DDL de referencia para consumidores sin Drizzle (spec 06 §3, regla 4).
-- Equivalente a lo que arma `@mafesoftware/limite-intentos/drizzle` con
-- `tablaIntentos()` (sin opciones: tabla "limite_intentos", SIN columna de
-- tenant). No es una migración: cada app genera las suyas con drizzle-kit
-- (o escribe la suya propia si no usa Drizzle) a partir de su propio
-- esquema — esto es solo la forma. Generado con
-- `generateDrizzleJson`/`generateMigration` de `drizzle-kit/api` sobre el
-- esquema real de `tablaIntentos()`, no escrito a mano.

CREATE TABLE "limite_intentos" (
	"clave" text PRIMARY KEY NOT NULL,
	"contador" integer DEFAULT 0 NOT NULL,
	"ventana_desde" timestamp with time zone DEFAULT now() NOT NULL,
	"bloqueado_hasta" timestamp with time zone,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);

-- "clave" es la ÚNICA clave (PK): "cuenta:<email normalizado>" o
-- "ip:<ip>" (ver claveCuenta/claveIp del núcleo). Es lo que hace atómico el
-- INSERT ... ON CONFLICT de `registrarIntento`.
--
-- "bloqueado_hasta" NO se limpia solo cuando expira: la fila se queda con
-- esa fecha aunque ya haya pasado — lo que importa es compararla contra
-- "ahora" en el momento de decidir (bloqueado_hasta > ahora), no que el
-- campo vuelva a NULL apenas expira. Sin cron de "desbloqueo".
--
-- Si tu app SÍ conoce el tenant al momento del intento (algo que este
-- paquete no asume: login pasa la mayoría de las veces sin tenant
-- conocido), `tablaIntentos({ tenant: {...} })` agrega una columna de
-- tenant NULLABLE (no NOT NULL como en otras tablas de negocio) — la app
-- la popula por su cuenta, `registrarIntento`/`consultarIntento`/
-- `limpiarIntentos` no la tocan. Ejemplo con esa columna (organizacion_id
-- uuid, NULLABLE):
--
-- CREATE TABLE "limite_intentos" (
-- 	"clave" text PRIMARY KEY NOT NULL,
-- 	"contador" integer DEFAULT 0 NOT NULL,
-- 	"ventana_desde" timestamp with time zone DEFAULT now() NOT NULL,
-- 	"bloqueado_hasta" timestamp with time zone,
-- 	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
-- 	"organizacion_id" uuid
-- );
