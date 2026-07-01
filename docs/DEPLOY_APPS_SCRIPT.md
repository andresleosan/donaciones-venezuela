# CI/CD de Google Apps Script

Esta guia documenta el despliegue automatico del backend Apps Script de `donaciones-venezuela` con CLASP y GitHub Actions.

## Objetivo

Cada push a `main` ejecuta el workflow `.github/workflows/deploy-apps-script.yml` y realiza este flujo:

1. Instala Node.js 22.
2. Instala `@google/clasp`.
3. Escribe la autenticacion CLASP desde GitHub Secrets.
4. Detecta y valida la carpeta `apps-script/`.
5. Valida sintaxis de `apps-script/*.gs`.
6. Ejecuta `clasp push --force`.
7. Crea una nueva version inmutable del Apps Script.
8. Actualiza el deployment existente.
9. Conserva la misma URL publica `/exec`.

## Identificadores usados

```text
SCRIPT_ID:
1lmeh3SBoa0Jv8NF4DcrQPy6R__VuSig1BgKV0XV9FIjB6fbelFHOuenX

DEPLOYMENT_ID:
AKfycbzIzkckhq_hur34K0JJZqyMG20QXnFXSHqa_CWhYITCMdCY6-e1GbhW99n0POsmtf0Q9g

URL /exec conservada:
https://script.google.com/macros/s/AKfycbzIzkckhq_hur34K0JJZqyMG20QXnFXSHqa_CWhYITCMdCY6-e1GbhW99n0POsmtf0Q9g/exec
```

El workflow no crea un deployment nuevo. Solo actualiza el deployment con ID anterior.

## Archivos creados

| Archivo | Funcion |
| --- | --- |
| `.clasp.json` | Vincula el repo al `SCRIPT_ID` y fija `rootDir` en `apps-script`. |
| `apps-script/appsscript.json` | Manifest local requerido por CLASP, con runtime V8 y web app publico. |
| `.github/workflows/deploy-apps-script.yml` | Workflow de deploy automatico en push a `main` y `workflow_dispatch`. |
| `scripts/apps-script-auth.sh` | Genera `~/.clasprc.json` desde secrets. |
| `scripts/apps-script-verify.sh` | Detecta carpeta Apps Script, valida config, manifest, sintaxis y deployment remoto. |
| `scripts/apps-script-deploy.sh` | Hace push, crea version y actualiza el deployment existente. |
| `scripts/apps-script-redeploy.sh` | Reapunta el deployment existente a una version sin ejecutar `clasp push`. |
| `.github/secrets.example.md` | Lista de secrets requeridos. |

## GitHub Secrets requeridos

Configura estos tres secrets en GitHub:

```text
CLASP_CLIENT_ID
CLASP_CLIENT_SECRET
CLASP_REFRESH_TOKEN
```

El usuario OAuth debe tener permisos para editar el Apps Script indicado por el `SCRIPT_ID` y para actualizar el deployment indicado por el `DEPLOYMENT_ID`.

## Configuracion inicial

1. Habilita la Apps Script API para la cuenta que administrara el script:

   ```text
   https://script.google.com/home/usersettings
   ```

2. Instala CLASP localmente para generar credenciales:

   ```bash
   npm install --global @google/clasp
   ```

3. Crea o usa un OAuth Client de tipo Desktop app en Google Cloud y descarga el JSON de credenciales.

4. Inicia sesion con CLASP usando esas credenciales:

   ```bash
   clasp login --creds credentials.json
   ```

5. Extrae los valores del archivo local `~/.clasprc.json`:

   ```bash
   node -e "const c=require(process.env.HOME+'/.clasprc.json'); console.log(c.oauth2ClientSettings.clientId)"
   node -e "const c=require(process.env.HOME+'/.clasprc.json'); console.log(c.oauth2ClientSettings.clientSecret)"
   node -e "const c=require(process.env.HOME+'/.clasprc.json'); console.log(c.token.refresh_token)"
   ```

6. Guarda los valores en GitHub Secrets:

   ```bash
   gh secret set CLASP_CLIENT_ID --body "..."
   gh secret set CLASP_CLIENT_SECRET --body "..."
   gh secret set CLASP_REFRESH_TOKEN --body "..."
   ```

7. Ejecuta manualmente el workflow una vez desde GitHub Actions con `workflow_dispatch`.

## Flujo CI/CD

El workflow ejecuta:

```bash
./scripts/apps-script-auth.sh
./scripts/apps-script-verify.sh --remote
./scripts/apps-script-deploy.sh --skip-auth --description "GitHub Actions ..."
```

`apps-script-deploy.sh` hace:

```bash
clasp list-deployments
clasp push --force
clasp create-version "descripcion"
clasp update-deployment "$DEPLOYMENT_ID" --versionNumber "$VERSION" --description "descripcion"
clasp list-deployments
```

Si la version instalada de CLASP no acepta `update-deployment` con flags, el script prueba las formas compatibles antes de fallar.

## Uso local

Validar solo configuracion y sintaxis:

```bash
bash scripts/apps-script-verify.sh
```

Validar tambien que el deployment existe en CLASP:

```bash
bash scripts/apps-script-verify.sh --remote
```

Deploy completo local:

```bash
export CLASP_CLIENT_ID="..."
export CLASP_CLIENT_SECRET="..."
export CLASP_REFRESH_TOKEN="..."
bash scripts/apps-script-deploy.sh --description "deploy local"
```

Reapuntar el deployment existente a una version previa:

```bash
bash scripts/apps-script-redeploy.sh --version 12 --description "rollback a version 12"
```

## Verificacion

Despues de un despliegue correcto:

1. `clasp list-deployments` debe seguir mostrando el mismo `DEPLOYMENT_ID`.
2. La URL debe seguir siendo:

   ```text
   https://script.google.com/macros/s/AKfycbzIzkckhq_hur34K0JJZqyMG20QXnFXSHqa_CWhYITCMdCY6-e1GbhW99n0POsmtf0Q9g/exec
   ```

3. No debe aparecer un deployment adicional creado por el workflow.
4. El workflow debe mostrar la version creada y el resultado de la actualizacion del deployment.

## Problemas comunes

| Sintoma | Causa probable | Solucion |
| --- | --- | --- |
| `Falta la variable de entorno requerida: CLASP_REFRESH_TOKEN` | Secret no configurado o con nombre incorrecto. | Revisa Settings > Secrets and variables > Actions. |
| `invalid_grant` | Refresh token revocado, caducado o generado con otro OAuth client. | Ejecuta `clasp login --creds credentials.json` otra vez y actualiza los secrets. |
| `insufficient authentication scopes` | El token fue creado sin permisos necesarios de Apps Script. | Borra `~/.clasprc.json`, repite login con CLASP y actualiza el refresh token. |
| `El deployment objetivo no aparece` | El usuario OAuth no tiene acceso al Apps Script o el `DEPLOYMENT_ID` no pertenece al script. | Comparte el Apps Script con ese usuario y confirma el ID con `clasp list-deployments`. |
| `Manifest file is required` | Falta `apps-script/appsscript.json`. | Mantener el manifest versionado. |
| El endpoint devuelve HTML de login | El deployment no esta publicado para acceso anonimo. | Confirmar que el manifest usa `ANYONE_ANONYMOUS` y redeplegar el deployment existente. |
| Se genero otra URL `/exec` | Se uso `create-deployment` o `deploy` sin `DEPLOYMENT_ID`. | Usar solo `apps-script-deploy.sh` o `apps-script-redeploy.sh`; ambos actualizan el ID existente. |

## Notas operativas

- No se modifica frontend, traducciones, busqueda familiar ni datos de Google Sheets.
- `SCRIPT_ID` y `DEPLOYMENT_ID` no son secretos; se versionan para evitar errores de target.
- Los secrets OAuth nunca deben guardarse en el repositorio.
- Si el codigo Apps Script agrega nuevos servicios de Google, puede requerir nuevos scopes y una reautorizacion inicial del usuario OAuth.
