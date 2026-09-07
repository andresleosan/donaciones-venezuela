import { configureAuthPersistence, getCurrentUser, observeAuth } from './firebase/firebase-auth.js';
import {
  archivoDesdeDataUrl,
  getPrivateFileUrl,
  requestPrivateFileDeletion,
  uploadPrivateFile,
} from './firebase/index.js';
import { crearSheetsServiceFirebase } from './data/sheets-service-firebase.js';

// Arranque del cliente Firebase.
//
// Este módulo va PRIMERO en el orden de los `<script>` de `index.html` y
// `ventana.html`, y todos los scripts legados llevan `defer`: los módulos y los
// scripts diferidos se ejecutan en orden de documento, así que `js/core.js`
// encuentra `window.SheetsService` ya publicado. Por eso aquí no hay `await` de
// nivel superior: lo que necesita red se lanza sin bloquear la evaluación.

// La sesión vive en memoria, no en `localStorage`.
//
// El legado guardaba el JWT de Supabase en `localStorage['dv-sesion']` para
// sobrevivir a las recargas. Con Firebase eso ya lo hace el propio SDK
// (`browserLocalPersistence` guarda el refresh token en IndexedDB), así que
// duplicar el ID token en `localStorage` solo añadiría un token de larga vida
// legible por cualquier script de la página. `js/core.js` lee y escribe aquí.
function crearAlmacenSesion() {
  let sesion = null;
  // Firebase restaura la sesión de IndexedDB de forma asíncrona. Sin esta
  // promesa, una página que pregunte «¿hay sesión?» nada más cargar siempre
  // recibe «no» y manda a iniciar sesión a quien ya la tiene.
  let resolverListo;
  const listo = new Promise((resolve) => { resolverListo = resolve; });

  function avisar() {
    globalThis.dispatchEvent(new CustomEvent('dv-sesion-change', { detail: { sesion } }));
  }

  return {
    listo,
    resuelta() {
      resolverListo(sesion);
    },
    get() {
      return sesion;
    },
    set(datos) {
      sesion = datos ? { ...(sesion ?? {}), ...datos } : null;
      avisar();
      return sesion;
    },
    clear() {
      sesion = null;
      avisar();
    },
  };
}

const almacenSesion = crearAlmacenSesion();
const servicio = crearSheetsServiceFirebase();

globalThis.DVSesion = almacenSesion;
globalThis.SheetsService = servicio;
// Los formularios legados capturan la foto con la camara y la tenian en una
// `data:` URL dentro del JSON. Ahora la suben antes y mandan solo el `path`.
async function subirFotoPrivada(categoria, dataUrl) {
  const usuario = await getCurrentUser();
  if (!usuario) throw new Error('Entra con tu cuenta para continuar');
  return uploadPrivateFile(usuario.uid, categoria, archivoDesdeDataUrl(dataUrl));
}

globalThis.DVFirebase = {
  getPrivateFileUrl,
  requestPrivateFileDeletion,
  subirFotoPrivada,
  uploadPrivateFile,
};

servicio.iniciarSincronizacion();

// El arranque de Auth espera a `DOMContentLoaded`, no al evaluar el módulo.
//
// Vite inyecta el bundle en el `<head>`, así que en `dist/` este módulo corre
// ANTES que `js/entorno.js` (que define `window.DV_ENTORNO`). La configuración
// de Firebase se lee de forma perezosa, pero conectarse aquí mismo la leería
// demasiado pronto; en `DOMContentLoaded` ya se han evaluado todos los scripts
// diferidos y la sobrescritura de entorno está en pie.
function arrancarAuth() {
  configureAuthPersistence('local')
    .then(() => observeAuth(async (usuario) => {
      if (!usuario) {
        almacenSesion.clear();
        almacenSesion.resuelta();
        return;
      }
      try {
        const resultado = await usuario.getIdTokenResult();
        almacenSesion.set({
          access_token: resultado.token,
          refresh_token: usuario.refreshToken ?? '',
          expires_at: Math.floor(new Date(resultado.expirationTime).getTime() / 1000),
          email: usuario.email ?? '',
        });
      } catch (err) {
        console.error('No se pudo leer la sesión de Firebase', err);
      } finally {
        almacenSesion.resuelta();
      }
    }))
    // Si falta alguna `VITE_*`, la app sigue en pie con la sesión vacía y el
    // error queda en consola, igual que cualquier fallo de lectura.
    .catch((err) => {
      console.error('No se pudo iniciar Firebase Auth', err);
      almacenSesion.resuelta();
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', arrancarAuth, { once: true });
} else {
  arrancarAuth();
}
