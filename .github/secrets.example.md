# GitHub Secrets requeridos

Configura estos secretos en el repositorio `andresleosan/donaciones-venezuela`:

| Secret | Descripcion |
| --- | --- |
| `CLASP_CLIENT_ID` | OAuth Client ID usado para autenticar CLASP. |
| `CLASP_CLIENT_SECRET` | OAuth Client Secret del mismo cliente OAuth. |
| `CLASP_REFRESH_TOKEN` | Refresh token del usuario que puede editar el Apps Script y actualizar deployments. |

No guardes valores reales en este archivo.

## Configuracion con GitHub CLI

```bash
gh secret set CLASP_CLIENT_ID --body "TU_CLIENT_ID"
gh secret set CLASP_CLIENT_SECRET --body "TU_CLIENT_SECRET"
gh secret set CLASP_REFRESH_TOKEN --body "TU_REFRESH_TOKEN"
```

El `SCRIPT_ID` y el `DEPLOYMENT_ID` no son secretos. Estan versionados en `.clasp.json` y en el workflow para asegurar que siempre se actualiza el deployment existente.
