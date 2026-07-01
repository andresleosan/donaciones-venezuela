#!/usr/bin/env bash
set -Eeuo pipefail

APPS_SCRIPT_SCRIPT_ID_DEFAULT="1lmeh3SBoa0Jv8NF4DcrQPy6R__VuSig1BgKV0XV9FIjB6fbelFHOuenX"
APPS_SCRIPT_DEPLOYMENT_ID_DEFAULT="AKfycbzIzkckhq_hur34K0JJZqyMG20QXnFXSHqa_CWhYITCMdCY6-e1GbhW99n0POsmtf0Q9g"

APPS_SCRIPT_TOOLS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
APPS_SCRIPT_REPO_ROOT="$(cd -- "${APPS_SCRIPT_TOOLS_DIR}/.." && pwd -P)"

log_info() {
  printf '[%s] INFO: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

log_warn() {
  printf '[%s] WARN: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

log_error() {
  printf '[%s] ERROR: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

die() {
  log_error "$*"
  exit 1
}

require_cmd() {
  local missing=()
  local cmd

  for cmd in "$@"; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      missing+=("$cmd")
    fi
  done

  if [[ ${#missing[@]} -gt 0 ]]; then
    die "Faltan comandos requeridos: ${missing[*]}"
  fi
}

require_env() {
  local name

  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      die "Falta la variable de entorno requerida: ${name}"
    fi
  done
}

apps_script_script_id() {
  printf '%s\n' "${SCRIPT_ID:-${CLASP_SCRIPT_ID:-$APPS_SCRIPT_SCRIPT_ID_DEFAULT}}"
}

apps_script_deployment_id() {
  printf '%s\n' "${DEPLOYMENT_ID:-${CLASP_DEPLOYMENT_ID:-$APPS_SCRIPT_DEPLOYMENT_ID_DEFAULT}}"
}

apps_script_exec_url() {
  local deployment_id
  deployment_id="$(apps_script_deployment_id)"
  printf '%s\n' "${APPS_SCRIPT_EXEC_URL:-https://script.google.com/macros/s/${deployment_id}/exec}"
}

read_json_field() {
  local file="$1"
  local field="$2"

  if command -v node >/dev/null 2>&1; then
    JSON_FILE="$file" JSON_FIELD="$field" node <<'NODE'
const fs = require('fs');
const file = process.env.JSON_FILE;
const field = process.env.JSON_FIELD;
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const value = data[field];
if (typeof value === 'string') process.stdout.write(value);
NODE
    return
  fi

  sed -nE 's/.*"'"${field}"'"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$file" | head -n 1
}

has_gs_files() {
  local dir="$1"
  local files=()

  shopt -s nullglob
  files=("$dir"/*.gs)
  shopt -u nullglob

  [[ ${#files[@]} -gt 0 ]]
}

detect_apps_script_dir_from_files() {
  local best_dir=""
  local best_score=-1
  local file dir rel score
  declare -A seen=()

  shopt -s globstar nullglob
  for file in "$APPS_SCRIPT_REPO_ROOT"/**/*.gs; do
    [[ "$file" == "$APPS_SCRIPT_REPO_ROOT/.git/"* ]] && continue
    dir="$(cd -- "$(dirname -- "$file")" && pwd -P)"
    rel="${dir#"$APPS_SCRIPT_REPO_ROOT"/}"
    [[ -n "${seen[$dir]:-}" ]] && continue
    seen[$dir]=1

    score=0
    [[ "$rel" == "apps-script" ]] && score=$((score + 100))
    if grep -Eq 'function[[:space:]]+do(Get|Post)|SpreadsheetApp|ContentService' "$file"; then
      score=$((score + 10))
    fi

    if [[ $score -gt $best_score ]]; then
      best_score=$score
      best_dir="$rel"
    fi
  done
  shopt -u globstar nullglob

  [[ -n "$best_dir" ]] && printf '%s\n' "$best_dir"
}

apps_script_root_dir() {
  local root_dir="${CLASP_ROOT_DIR:-}"
  local clasp_file="$APPS_SCRIPT_REPO_ROOT/.clasp.json"
  local absolute

  if [[ -z "$root_dir" && -f "$clasp_file" ]]; then
    root_dir="$(read_json_field "$clasp_file" "rootDir" || true)"
  fi

  if [[ -z "$root_dir" && -d "$APPS_SCRIPT_REPO_ROOT/apps-script" ]]; then
    root_dir="apps-script"
  fi

  if [[ -z "$root_dir" ]]; then
    root_dir="$(detect_apps_script_dir_from_files || true)"
  fi

  [[ -n "$root_dir" ]] || die "No se pudo detectar la carpeta de Apps Script"

  absolute="$APPS_SCRIPT_REPO_ROOT/$root_dir"
  [[ -d "$absolute" ]] || die "La carpeta Apps Script no existe: $root_dir"
  has_gs_files "$absolute" || die "La carpeta Apps Script no contiene archivos .gs: $root_dir"

  printf '%s\n' "$root_dir"
}

validate_clasp_config() {
  local detected_root="$1"
  local clasp_file="$APPS_SCRIPT_REPO_ROOT/.clasp.json"
  local expected_script_id actual_script_id actual_root

  [[ -f "$clasp_file" ]] || die "Falta .clasp.json"

  expected_script_id="$(apps_script_script_id)"
  actual_script_id="$(read_json_field "$clasp_file" "scriptId" || true)"
  actual_root="$(read_json_field "$clasp_file" "rootDir" || true)"

  [[ "$actual_script_id" == "$expected_script_id" ]] || die ".clasp.json usa scriptId inesperado"
  [[ "$actual_root" == "$detected_root" ]] || die ".clasp.json rootDir (${actual_root}) no coincide con carpeta detectada (${detected_root})"
}

validate_apps_script_manifest() {
  local root_dir="$1"
  local manifest="$APPS_SCRIPT_REPO_ROOT/$root_dir/appsscript.json"

  [[ -f "$manifest" ]] || die "Falta manifest Apps Script: ${root_dir}/appsscript.json"
  require_cmd node

  APPS_SCRIPT_MANIFEST="$manifest" node <<'NODE'
const fs = require('fs');
const manifest = process.env.APPS_SCRIPT_MANIFEST;
JSON.parse(fs.readFileSync(manifest, 'utf8'));
NODE
}

validate_gas_syntax() {
  local root_dir="$1"
  local absolute="$APPS_SCRIPT_REPO_ROOT/$root_dir"

  require_cmd node

  APPS_SCRIPT_SOURCE_DIR="$absolute" node <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.env.APPS_SCRIPT_SOURCE_DIR;
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.gs')) {
      files.push(full);
    }
  }
}

walk(root);
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  try {
    new Function(source);
  } catch (error) {
    console.error(`${path.relative(root, file)}: ${error.message}`);
    process.exit(1);
  }
}
console.log(`Apps Script syntax OK (${files.length} .gs file(s))`);
NODE
}

clasp_create_version() {
  local description="$1"
  local output version

  output="$(clasp create-version "$description" 2>&1)"
  printf '%s\n' "$output" >&2

  version="$(printf '%s\n' "$output" | sed -nE 's/.*[Vv]ersion[^0-9]*([0-9]+).*/\1/p' | tail -n 1)"
  [[ -n "$version" ]] || version="$(printf '%s\n' "$output" | sed -nE 's/^([0-9]+)$/\1/p' | tail -n 1)"
  [[ -n "$version" ]] || die "No se pudo extraer el numero de version creado por CLASP"

  printf '%s\n' "$version"
}

clasp_update_deployment() {
  local deployment_id="$1"
  local version_number="$2"
  local description="$3"
  local output

  if output="$(clasp update-deployment "$deployment_id" --versionNumber "$version_number" --description "$description" 2>&1)"; then
    printf '%s\n' "$output" >&2
    return 0
  fi

  log_warn "CLASP no acepto update-deployment con flags; probando argumentos posicionales"
  printf '%s\n' "$output" >&2

  if output="$(clasp update-deployment "$deployment_id" "$version_number" "$description" 2>&1)"; then
    printf '%s\n' "$output" >&2
    return 0
  fi

  log_warn "CLASP no acepto update-deployment posicional; probando comando deploy compatible"
  printf '%s\n' "$output" >&2

  clasp deploy --deploymentId "$deployment_id" --versionNumber "$version_number" --description "$description"
}

clasp_list_deployments() {
  local output

  output="$(clasp list-deployments 2>&1)"
  printf '%s\n' "$output" >&2
  printf '%s\n' "$output"
}
