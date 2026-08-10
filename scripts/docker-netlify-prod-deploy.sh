#!/bin/bash
# Linux-side Netlify production deploy (avoids Windows path corruption in Next server handler)
set -euo pipefail
cd /app
echo "Installing netlify-cli..."
npm install -g netlify-cli@23.1.3 >/tmp/ntl-install.log 2>&1 || npm install -g netlify-cli >/tmp/ntl-install.log 2>&1
echo "Building site with Netlify (Linux)..."
# Run from repo root so root netlify.toml applies (no base)
netlify deploy --prod --build --cwd /app --site bed664bf-1b1e-4b20-91b9-3a56d19a4894
echo "DEPLOY_FINISHED"
