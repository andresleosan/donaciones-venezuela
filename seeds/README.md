# Semillas del Emulator Suite

`seeds/emulador/` es un export del Emulator Suite (`auth_export/` + `firestore_export/`) con
**datos sintéticos**, no con datos reales de nadie. Todo lo sembrado lleva marca reconocible:
`PRUEBA · ` en los nombres, `@prueba.local` en los correos y `DV-SEED-*` en los tokens de factura.
No hay ningún dato migrado de Supabase.

## Regenerarlas

```
npm.cmd run seed:emulador
```

Compila las Functions, arranca los emuladores de Auth y Firestore, ejecuta
`functions/scripts/semilla-firebase.mjs` y exporta el resultado a esta carpeta
(`--export-on-exit`). El script **se niega a correr** si `FIRESTORE_EMULATOR_HOST` o
`FIREBASE_AUTH_EMULATOR_HOST` no apuntan a `127.0.0.1`: sembrar esto contra el proyecto real
sería contaminar producción con datos falsos.

Las proyecciones públicas se derivan con `proyeccionPublica()`, la misma función que usan las
acciones de la API. Si cambia una allowlist de `functions/src/public-projections.ts`, hay que
regenerar las semillas para que sigan reflejando lo que la app publicaría de verdad.

## Usarlas

```
npx.cmd firebase emulators:start --project demo-donaciones-venezuela --import=./seeds/emulador
npm.cmd run dev
```

Para que el navegador hable con los emuladores en vez de con Firebase, `js/entorno.js` (que se
sirve fuera del repositorio) debe definir:

```js
window.DV_ENTORNO = {
  emuladores: true,
  apiBase: 'http://127.0.0.1:5001/demo-donaciones-venezuela/us-east1',
  firebaseConfig: {
    apiKey: 'demo', authDomain: 'demo-donaciones-venezuela.firebaseapp.com',
    projectId: 'demo-donaciones-venezuela', storageBucket: 'demo-donaciones-venezuela.appspot.com',
    messagingSenderId: '0', appId: 'demo',
  },
};
```

## Qué contienen

| Colección | Documentos |
|---|---|
| `lugares` + `lugaresPublicos` | 3 (Hospital Vargas, Ambulatorio Centro, Refugio Catia) con sus insumos. El Ambulatorio tiene *Colchonetas* `Disponible` y el Refugio las necesita: eso es lo que hace visibles las `coincidencias` y los traslados sugeridos en la UI. |
| `voluntarios` + `voluntariosPublicos` | 2 |
| `motorizados` + `motorizadosPublicos` | 2 (la proyección no lleva teléfono ni placa) |
| `vacantes` + `vacantesPublicas` | 1, en estado `Abierta` |
| `facturas` + `facturasPublicas` | 2: `DV-SEED-PRES-0001` (dinero, abierta, 300/850, con desglose de donaciones) y `DV-SEED-NEC-0002` (necesidad, comprada) |
| `tasas/actual` | 250 Bs/USD, fuente `seed` |
| `estadisticas/global` | contadores derivados de lo anterior |
| `config/contadores` | `facturaSeq: 2`, para que la siguiente factura sea la `FAC-2026-000003` |

Cuentas de Auth (contraseña `prueba1234` en todas):

| Correo | Claims |
|---|---|
| `admin@prueba.local` | `{ role: 'admin' }` |
| `panel@prueba.local` | `{ role: 'panel', panelLugarId: 'LUG-SEED-1' }` |
| `user@prueba.local` | ninguno (donante) |

La tasa es 250 y no la histórica 36,5 porque `functions/src/api/tasas.ts` considera plausible solo
`200 < x < 5000` (el rango del legado): con 36,5 la app se quedaría sin equivalentes en USD.

Los `uid` de Auth los genera el emulador y cambian en cada regeneración, igual que el `updatedAt`
que sella `proyeccionPublica`. Todo lo demás es determinista.
