#!/bin/bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
cd "$project_dir"

if [[ "$(uname -s)" != 'Darwin' ]]; then
  printf '%s\n' 'Run this script on a Mac.'
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf '%s\n' 'Install Node.js 24 from https://nodejs.org/en/download, then run this script again.'
  exit 1
fi
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 12)) { console.error("Node.js 22.12 or newer is required; Node.js 24 is recommended."); process.exit(1); }'

requested_arch="${1:-$(uname -m)}"
case "$requested_arch" in
  arm64) architecture_args=(--arm64) ;;
  x64|x86_64) architecture_args=(--x64) ;;
  all) architecture_args=(--arm64 --x64) ;;
  *) printf '%s\n' 'Usage: bash scripts/build-macos-local.command [arm64|x64|all]'; exit 2 ;;
esac

npm ci --include=dev
npm run prepare:icon
npm run build

# Ad-hoc signing supports local testing without a Developer ID certificate.
CSC_IDENTITY_AUTO_DISCOVERY=false ./node_modules/.bin/electron-builder \
  --config build/electron-builder.preview.cjs \
  --mac dmg "${architecture_args[@]}" \
  --config.mac.identity=- \
  --config.mac.entitlements=scripts/preview-entitlements.plist \
  --config.mac.entitlementsInherit=scripts/preview-entitlements.plist \
  --publish never

app_version="$(node -p 'require("./package.json").version')"
printf '\nDMG output: %s/release/%s/\n' "$project_dir" "$app_version"
