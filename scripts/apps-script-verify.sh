#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=apps-script-common.sh
source "$SCRIPT_DIR/apps-script-common.sh"

usage() {
  cat <<'EOF'
Usage: scripts/apps-script-verify.sh [OPTIONS]

Validates local CLASP configuration and Apps Script syntax.

Options:
  --remote      Also verify the configured deployment exists in CLASP.
  -h, --help    Show this help.
EOF
}

main() {
  local with_remote=false
  local root_dir deployment_id deployments exec_url

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --remote)
        with_remote=true
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

  root_dir="$(apps_script_root_dir)"
  deployment_id="$(apps_script_deployment_id)"
  exec_url="$(apps_script_exec_url)"

  log_info "Carpeta Apps Script detectada: ${root_dir}"
  validate_clasp_config "$root_dir"
  validate_apps_script_manifest "$root_dir"
  validate_gas_syntax "$root_dir"
  log_info "Script ID: $(apps_script_script_id)"
  log_info "Deployment ID objetivo: ${deployment_id}"
  log_info "Endpoint /exec esperado: ${exec_url}"

  if [[ "$with_remote" == true ]]; then
    require_cmd clasp grep
    deployments="$(clasp_list_deployments)"
    if ! grep -Fq "$deployment_id" <<<"$deployments"; then
      die "El deployment objetivo no aparece en clasp list-deployments: ${deployment_id}"
    fi
    log_info "Deployment objetivo encontrado en CLASP"
  fi
}

main "$@"
