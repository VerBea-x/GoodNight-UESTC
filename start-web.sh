#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Please install Node.js 22 or newer.'
  exit 1
fi
if [ ! -f node_modules/playwright/package.json ] || [ ! -f node_modules/leaflet/package.json ] || [ ! -f node_modules/coordtransform/package.json ]; then npm ci; fi
exec node bin/goodnight.mjs web
