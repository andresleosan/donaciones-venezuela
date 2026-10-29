import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DEMO_STORAGE_BUCKET } from '../emulators/entorno.js';

// Guarda de regresion de una costura real: el cliente apuntaba a un bucket, las
// pruebas de emulador a otro y Functions resolvia un tercero con el bucket por
// defecto. Cliente y servidor deben nombrar el MISMO bucket en cada proyecto.
function leerEnv(ruta: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(ruta, 'utf8')
      .split('\n')
      .map((linea) => linea.trim())
      .filter((linea) => linea && !linea.startsWith('#'))
      .map((linea) => {
        const corte = linea.indexOf('=');
        return [linea.slice(0, corte).trim(), linea.slice(corte + 1).trim()];
      }),
  );
}

it('la plantilla de Functions coincide con el bucket del cliente al configurar el proyecto', () => {
  const cliente = leerEnv('.env.example');
  const servidor = leerEnv('functions/.env.example');

  expect(cliente.VITE_FIREBASE_PROJECT_ID).toBeTruthy();
  expect(servidor.STORAGE_BUCKET.replace('your-project-id', cliente.VITE_FIREBASE_PROJECT_ID))
    .toBe(cliente.VITE_FIREBASE_STORAGE_BUCKET);
  expect(servidor.STORAGE_BUCKET).toBeTruthy();
});

it('la plantilla demo declara el bucket que sirve el emulador', () => {
  const servidor = leerEnv('functions/.env.demo.example');

  expect(servidor.STORAGE_BUCKET).toBe(DEMO_STORAGE_BUCKET);
});

it('las plantillas limitan App Check deshabilitado al emulador y exigen enforced fuera de el', () => {
  expect(leerEnv('functions/.env.demo.example').APP_CHECK_MODE).toBe('disabled');
  expect(leerEnv('functions/.env.example').APP_CHECK_MODE).toBe('enforced');
});
