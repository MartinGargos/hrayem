#!/usr/bin/env bash

set -euo pipefail

required_node_version="20.19.4"

has_supported_node() {
  node -e '
const [major, minor, patch] = process.versions.node.split(".").map(Number);
const isSupported =
  major > 20 || (major === 20 && (minor > 19 || (minor === 19 && patch >= 4)));
process.exit(isSupported ? 0 : 1);
'
}

if command -v node >/dev/null 2>&1 && has_supported_node; then
  exec "$@"
fi

nvm_node_dir="$HOME/.nvm/versions/node/v${required_node_version}/bin"

if [ -x "${nvm_node_dir}/node" ]; then
  export PATH="${nvm_node_dir}:$PATH"
  exec "$@"
fi

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.nvm/nvm.sh"
  nvm use "$required_node_version" >/dev/null
  exec "$@"
fi

printf 'Node %s is required. Install it with `nvm install %s` and retry.\n' \
  "$required_node_version" \
  "$required_node_version" >&2
exit 1
