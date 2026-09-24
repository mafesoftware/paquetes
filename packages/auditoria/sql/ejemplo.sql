-- DDL de referencia para consumidores sin Drizzle (spec 06 §3, regla 4).
-- Equivalente a lo que arma `@mafesoftware/auditoria/drizzle` con
-- `tablaAuditoria()` (sin opciones: tabla "auditoria", columna de tenant
-- "organizacion_id" uuid — la que da `columnaTenant()` de
-- `@mafesoftware/tenant/drizzle`). No es una migración: cada app genera
-- las suyas con drizzle-kit (o escribe la suya propia si no usa Drizzle) a
-- partir de su propio esquema — esto es solo la forma. La CREATE TABLE y
-- los índices salen de `generateDrizzleJson`/`generateMigration` de
-- `drizzle-kit/api` sobre el esquema real de `tablaAuditoria()`, no
-- escritos a mano.

CREATE TABLE "auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacion_id" uuid NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text NOT NULL,
	"accion" text NOT NULL,
	"actor_tipo" text NOT NULL,
	"actor_id" text,
	"antes" jsonb,
	"despues" jsonb,
	"cambios" jsonb NOT NULL,
	"ip" text,
	"user_agent" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);

-- Índices NO únicos (una entidad tiene MUCHAS filas de auditoría, una por
-- cambio): el historial de una entidad puntual, más reciente primero, y el
-- historial completo de un tenant (sin filtrar por entidad).
CREATE INDEX "auditoria_tenant_entidad_idx" ON "auditoria" USING btree ("organizacion_id","entidad","entidad_id","creado_en");
CREATE INDEX "auditoria_tenant_creado_idx" ON "auditoria" USING btree ("organizacion_id","creado_en");

-- ============================================================================
-- Trigger de inmutabilidad — NO es parte de la migración generada por
-- drizzle-kit (que no sabe generar triggers): se agrega como una migración
-- ESCRITA A MANO aparte, DESPUÉS de la de arriba, con el resultado exacto de
-- `sqlInmutabilidad("auditoria")` de `@mafesoftware/auditoria/drizzle`.
-- Idempotente (CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS antes de
-- cada CREATE TRIGGER): se puede correr más de una vez sin fallar.
-- ============================================================================

CREATE OR REPLACE FUNCTION "auditoria_bloquear_escritura"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla "auditoria" es de solo lectura (auditoría inmutable): no se permite % en esta tabla.', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "auditoria_no_update_delete" ON "auditoria";
CREATE TRIGGER "auditoria_no_update_delete"
  BEFORE UPDATE OR DELETE ON "auditoria"
  FOR EACH ROW EXECUTE FUNCTION "auditoria_bloquear_escritura"();

DROP TRIGGER IF EXISTS "auditoria_no_truncate" ON "auditoria";
CREATE TRIGGER "auditoria_no_truncate"
  BEFORE TRUNCATE ON "auditoria"
  FOR EACH STATEMENT EXECUTE FUNCTION "auditoria_bloquear_escritura"();
