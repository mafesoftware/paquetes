// Subcarpeta drizzle/: permitido importar drizzle-orm aquí.
import { pgTable, text } from 'drizzle-orm/pg-core';

export function tabla(nombre: string) {
  return pgTable(nombre, { id: text('id') });
}
