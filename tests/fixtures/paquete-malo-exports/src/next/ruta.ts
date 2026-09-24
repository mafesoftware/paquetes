// Subcarpeta next/: permitido importar next/react aquí.
import type { NextRequest } from 'next';

export function manejar(req: NextRequest) {
  return req.url;
}
