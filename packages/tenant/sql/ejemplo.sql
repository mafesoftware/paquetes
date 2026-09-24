-- DDL de referencia para consumidores sin Drizzle (spec 06 §3, regla 4).
-- Equivalente a lo que arma `@mafesoftware/tenant/drizzle` con
-- `columnaTenant` + `unicoConTenant` + `fkTenant` para el ejemplo del
-- README (padre "proyectos" + hija "unidades"). No es una migración: cada
-- app genera las suyas con drizzle-kit (o escribe la suya propia si no usa
-- Drizzle) a partir de su propio esquema — esto es solo la forma.

create table "proyectos" (
  "id" uuid primary key,
  "organizacion_id" uuid not null,
  "nombre" text not null,
  -- Necesario para que "unidades" pueda referenciar (organizacion_id, id)
  -- como PAR: Postgres exige que una FK apunte a una clave (primary key o
  -- unique) de la tabla referenciada, y el par no lo es aunque "id" ya sea
  -- primary key por sí sola.
  constraint "proyectos_organizacion_id_id_unique" unique ("organizacion_id", "id")
);

create table "unidades" (
  "id" uuid primary key,
  "organizacion_id" uuid not null,
  "proyecto_id" uuid not null,
  "nombre" text not null,
  -- La FK compuesta: rechaza una fila con organizacion_id = B que apunte a
  -- un proyecto de organizacion_id = A (foreign_key_violation, código
  -- 23503) — una FK simple sobre proyecto_id sola no lo detecta.
  constraint "unidades_organizacion_id_proyecto_id_fk"
    foreign key ("organizacion_id", "proyecto_id")
    references "proyectos" ("organizacion_id", "id")
);
