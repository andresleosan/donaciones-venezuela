// Punto de sobrescritura del backend. En producción este archivo es un stub
// vacío a propósito: el cliente usa las variables `VITE_*` que Vite incrusta en
// `src/main.js` durante el build.
//
// El entorno de pruebas sirve este mismo path con un archivo que define
//
//   window.DV_ENTORNO = {
//     apiBase: 'http://127.0.0.1:5001/demo-donaciones-venezuela/us-east1',
//     firebaseConfig: { apiKey, authDomain, projectId, storageBucket,
//                       messagingSenderId, appId }
//   };
//
// apuntando a su propio proyecto Firebase (o al Emulator Suite). Ese archivo
// vive fuera del repositorio, así que no puede llegar a producción por un merge.
//
// Ojo con el orden: en el HTML fuente este script va antes del módulo, pero en
// `dist/` Vite inyecta el bundle en el `<head>` y lo adelanta. Por eso nada lee
// `DV_ENTORNO` al evaluar un módulo: `src/firebase/firebase-config.js` y
// `src/data/api-client.js` lo consultan en cada llamada, y `src/main.js` espera
// a `DOMContentLoaded` para conectar con Firebase Auth.
