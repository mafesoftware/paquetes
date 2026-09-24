import { S3Client } from '@aws-sdk/client-s3';

export function saludar(nombre: string): string {
  return `Hola, ${nombre}! ${String(S3Client)}`;
}
