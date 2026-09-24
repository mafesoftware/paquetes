import type { NextRequest } from 'next';

export function saludar(_req: NextRequest, nombre: string): string {
  return `Hola, ${nombre}!`;
}
