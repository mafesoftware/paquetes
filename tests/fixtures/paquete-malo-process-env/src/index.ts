export function saludar(nombre: string): string {
  const saludo = process.env.SALUDO ?? 'Hola';
  return `${saludo}, ${nombre}!`;
}
