#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=apps-script-common.sh
source "$SCRIPT_DIR/apps-script-common.sh"

usage() {
  cat <<'EOF'
Usage: scripts/apps-script-auth.sh

Writes ~/.clasprc.json from GitHub Secrets / environment variables.

Required environment variables:
  CLASP_CLIENT_ID
  CLASP_CLIENT_SECRET
  CLASP_REFRESH_TOKEN

Optional:
  CLASP_AUTH_PATH  Path to write credentials. Defaults to $HOME/.clasprc.json.
EOF
}

main() {
  local auth_path="${CLASP_AUTH_PATH:-$HOME/.clasprc.json}"

  if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
  fi

  require_cmd node mkdir
  require_env CLASP_CLIENT_ID CLASP_CLIENT_SECRET CLASP_REFRESH_TOKEN

  umask 077
  mkdir -p "$(dirname -- "$auth_path")"

  CLASP_AUTH_PATH="$auth_path" node <<'NODE'
const fs = require('fs');

const authPath = process.env.CLASP_AUTH_PATH;
const scopes = [
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/script.deployments.readonly',
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.webapp.deploy',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/service.management',
  'https://www.googleapis.com/auth/cloud-platform'
].join(' ');

const auth = {
  token: {
    access_token: '',
    refresh_token: process.env.CLASP_REFRESH_TOKEN,
    scope: scopes,
    token_type: 'Bearer',
    expiry_date: 0
  },
  oauth2ClientSettings: {
    clientId: process.env.CLASP_CLIENT_ID,
    clientSecret: process.env.CLASP_CLIENT_SECRET,
    redirectUri: 'http://localhost'
  },
  isLocalCreds: false
};

fs.writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
NODE

  log_info "Credenciales CLASP escritas en ${auth_path}"
}

main "$@"
