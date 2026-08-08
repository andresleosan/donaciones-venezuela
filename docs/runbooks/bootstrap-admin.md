# Runbook de bootstrap administrativo

## Alcance y control

Este procedimiento asigna el claim `role: admin` a un UID que ya existe en
Firebase Auth. Es una operación local y controlada por el operador:

- No existe una ruta HTTP para otorgar roles.
- El cliente nunca escribe custom claims.
- El script exige un proyecto permitido, un UID explícito y
  `BOOTSTRAP_ADMIN_APPROVED=YES`.
- El agente no ejecuta este procedimiento ni se conecta a ningún proyecto
  Firebase como parte de esta tarea.

## Precondiciones

Antes de ejecutar, el operador debe:

1. Confirmar el proyecto exacto: `demo-donaciones-venezuela` para pruebas
   locales o `donaciones-venezuela-4fc29` para desarrollo.
2. Tener credenciales ADC locales disponibles y vigentes, sin copiarlas al
   repositorio, a los argumentos ni a los logs.
3. Verificar que el UID ya pertenece al proyecto Firebase confirmado.
4. Confirmar que la asignación administrativa fue aprobada para esa ventana.

## Ejecución

Desde `functions/`, establecer los nombres de variables en la sesión del
operador. Sustituir `<UID_EXISTENTE>` por el UID confirmado, sin escribirlo en
este runbook:

```powershell
$env:FIREBASE_PROJECT_ID = 'demo-donaciones-venezuela'
$env:BOOTSTRAP_ADMIN_UID = '<UID_EXISTENTE>'
$env:BOOTSTRAP_ADMIN_APPROVED = 'YES'
npm.cmd run bootstrap-admin
```

El comando compila Functions y luego ejecuta el script local. La salida exitosa
contiene únicamente `uid` y `role`. Si una guarda falla, el Admin SDK no se
importa ni se inicializa. No reutilizar una aprobación antigua para otro
proyecto o UID.

## Validación posterior

1. Comprobar que la salida contiene el UID confirmado y `"role":"admin"`.
2. Cerrar la sesión del usuario y abrirla nuevamente para obtener un token de
   ID nuevo; los claims se incluyen en tokens emitidos después del cambio.
3. Validar el rol con el flujo autenticado autorizado, sin registrar el token,
   el correo, el objeto de usuario ni los claims completos.

## Rollback

El rollback consiste en retirar el claim `admin` mediante un procedimiento
separado y revisado. No se ejecuta automáticamente y no forma parte de este
script. Antes de aplicarlo, se debe preservar cualquier claim legítimo restante
y confirmar nuevamente el UID y el proyecto.
