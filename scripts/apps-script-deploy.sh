#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=apps-script-common.sh
source "$SCRIPT_DIR/apps-script-common.sh"

usage() {
  cat <<'EOF'
Usage: scripts/apps-script-deploy.sh [OPTIONS]

Pushes Apps Script source, creates a new immutable version, and updates the
existing deployment ID. It does not create a new deployment URL.

Options:
  --description TEXT  Version/deployment description.
  --skip-auth         Do not write ~/.clasprc.json from CLASP_* env vars.
  --dry-run           Print the detected configuration without calling CLASP.
  -h, --help          Show this help.
EOF
}

main() {
  local description=""
  local skip_auth=false
  local dry_run=false
  local root_dir deployment_id exec_url version_number deployments_before deployments_after

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --description)
        description="${2:-}"
        [[ -n "$description" ]] || die "--description requiere un valor"
        shift 2
        ;;
      --skip-auth)
        skip_auth=true
        shift
        ;;
      --dry-run)
        dry_run=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Opcion no reconocida: $1"
        ;;
    esac
  done

  description="${description:-CI Apps Script deploy $(date -u '+%Y-%m-%dT%H:%M:%SZ')}"
  root_dir="$(apps_script_root_dir)"
  deployment_id="$(apps_script_deployment_id)"
  exec_url="$(apps_script_exec_url)"

  if [[ "$skip_auth" == false ]]; then
    if [[ -n "${CLASP_CLIENT_ID:-}" || -n "${CLASP_CLIENT_SECRET:-}" || -n "${CLASP_REFRESH_TOKEN:-}" ]]; then
      "$SCRIPT_DIR/apps-script-auth.sh"
    else
      log_info "No se recibieron CLASP_* secrets; se usara la autenticacion CLASP local existente"
    fi
  fi

  validate_clasp_config "$root_dir"
  validate_apps_script_manifest "$root_dir"
  validate_gas_syntax "$root_dir"

  log_info "Deploy preparado"
  log_info "Root Apps Script: ${root_dir}"
  log_info "Script ID: $(apps_script_script_id)"
  log_info "Deployment ID: ${deployment_id}"
  log_info "Endpoint conservado: ${exec_url}"

  if [[ "$dry_run" == true ]]; then
    log_info "Dry-run activo; no se llamara a clasp"
    exit 0
  fi

  require_cmd clasp grep

  log_info "Deployments antes del despliegue"
  deployments_before="$(clasp_list_deployments)"
  if ! grep -Fq "$deployment_id" <<<"$deployments_before"; then
    die "El deployment objetivo no existe o no es visible para CLASP: ${deployment_id}"
  fi

  log_info "Ejecutando clasp push --force"
  clasp push --force

  log_info "Creando nueva version Apps Script"
  version_number="$(clasp_create_version "$description")"
  log_info "Version creada: ${version_number}"

  log_info "Actualizando deployment existente"
  clasp_update_deployment "$deployment_id" "$version_number" "$description"

  log_info "Deployments despues del despliegue"
  deployments_after="$(clasp_list_deployments)"
  if ! grep -Fq "$deployment_id" <<<"$deployments_after"; then
    die "El deployment objetivo dejo de aparecer despues del update: ${deployment_id}"
  fi

  log_info "Despliegue completado sin crear una URL /exec nueva"
  log_info "Endpoint publico: ${exec_url}"
}

main "$@"
