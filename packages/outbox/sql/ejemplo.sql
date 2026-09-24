-- DDL de referencia para consumidores sin Drizzle (spec 06 §3, regla 4).
-- Equivalente a lo que arma `@mafesoftware/outbox/drizzle` con
-- `tablaOutbox()` (sin opciones: tabla "outbox", columna de tenant
-- "organizacion_id" uuid — la que da `columnaTenant()` de
-- `@mafesoftware/tenant/drizzle`). No es una migración: cada app genera
-- las suyas con drizzle-kit (o escribe la suya propia si no usa Drizzle) a
-- partir de su propio esquema — esto es solo la forma. Generado con
-- `generateDrizzleJson`/`generateMigration` de `drizzle-kit/api` sobre el
-- esquema real de `tablaOutbox()`, no escrito a mano.

CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacion_id" uuid NOT NULL,
	"canal" text NOT NULL,
	"destino" text NOT NULL,
	"plantilla" text NOT NULL,
	"datos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"clave_idempotencia" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"max_intentos" integer DEFAULT 5 NOT NULL,
	"programado_para" timestamp with time zone DEFAULT now() NOT NULL,
	"proximo_intento_en" timestamp with time zone,
	"bloqueado_hasta" timestamp with time zone,
	"ultimo_error_categoria" text,
	"ultimo_error_codigo" text,
	"id_externo" text,
	"enviado_en" timestamp with time zone,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);

-- Único (tenant, clave_idempotencia): es lo que hace que el
-- `INSERT ... ON CONFLICT DO NOTHING` de `encolar` sea idempotente.
CREATE UNIQUE INDEX "outbox_tenant_clave_idem_key" ON "outbox" USING btree ("organizacion_id","clave_idempotencia");

-- (estado, proximo_intento_en): el que usa la consulta de reclamo de
-- `procesarOutbox` (`SELECT ... FOR UPDATE SKIP LOCKED`) para encontrar
-- rápido las filas "pendiente" que ya les toca, sin recorrer toda la tabla.
CREATE INDEX "outbox_estado_proximo_idx" ON "outbox" USING btree ("estado","proximo_intento_en");

-- "ultimo_error_categoria"/"ultimo_error_codigo": SOLO la categoría
-- (ej. "credenciales") y un código corto (ej. "sin_credenciales"), NUNCA el
-- mensaje de error crudo del proveedor — puede traer el destinatario o el
-- cuerpo del mensaje. `procesarOutbox` nunca escribe otra cosa acá.
