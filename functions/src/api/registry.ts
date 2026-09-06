import type { ActionDefinition } from './contract.js';

// Registro de acciones de la Function `api`. Cada dominio se registra a si mismo
// al ser importado desde `functions/src/api/index.ts`; el despachador solo
// consulta este mapa y nunca conoce los dominios.
const acciones = new Map<string, ActionDefinition>();

export function defineAction(definicion: ActionDefinition): ActionDefinition {
  const nombre = definicion.nombre.trim();
  if (!nombre) throw new Error('accion-sin-nombre');
  if (acciones.has(nombre)) throw new Error(`accion-duplicada:${nombre}`);
  acciones.set(nombre, { ...definicion, nombre });
  return definicion;
}

export function getAction(nombre: string): ActionDefinition | undefined {
  return acciones.get(nombre);
}

export function listActions(): string[] {
  return [...acciones.keys()].sort();
}

// Solo para pruebas: deja el registro vacio entre casos.
export function resetActions(): void {
  acciones.clear();
}
