import { pgTable } from 'drizzle-orm/pg-core';

export function saludar(nombre: string): string {
  return `Hola, ${nombre}! ${String(pgTable)}`;
}
