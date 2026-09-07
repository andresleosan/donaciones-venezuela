// Punto de registro de las acciones de la Function `api`.
//
// Cada dominio se registra al importarse (efecto de modulo). El despachador
// (`http.ts`) nunca importa dominios: consulta el registro. Anadir un dominio es
// anadir una linea aqui.
//
// Orden de incorporacion previsto (plan 2026-09-06, fase 3):
//   3.1 lugares e insumos · 3.2 personas · 3.3 vacantes · 3.4 facturas
//   3.5 transporte · 3.6 denuncias y familias · 3.7 consola de datos
//
// El reconciliador registra `admin_reconstruir_proyecciones` y es donde cada
// dominio declarara su fuente de proyeccion.
import '../jobs/reconciliar-proyecciones.js';

import './lugares.js';
import './personas.js';
import './vacantes.js';
import './facturas.js';
import './presupuestos.js';
import './ofertas.js';
import './viajes.js';
import './damnificados.js';
import './denuncias.js';

export { apiHandler, API_MESSAGES } from './http.js';
export { defineAction, getAction, listActions } from './registry.js';
export * from './contract.js';
