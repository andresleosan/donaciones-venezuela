# Adaptadores Firebase

Estos módulos son la frontera de infraestructura para la migración. No contienen secretos y leen la configuración desde variables `VITE_FIREBASE_*` o `window.DV_ENTORNO.firebaseConfig`.

Las reglas locales permanecen deny-by-default hasta que cada repositorio tenga una consulta y una política de acceso probadas. La siguiente fase debe integrar estos adaptadores en la fachada de datos, migrar Auth y añadir pruebas con Emulator Suite antes de abrir Firestore o Storage.
