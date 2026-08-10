#!/bin/bash
set -euo pipefail
cd /app
echo "=== Simulating Netlify base=apps/web build ==="
cd apps/web
echo "cwd=$(pwd)"
echo "=== Running build command ==="
cd ../.. && npm ci && npm run build -w apps/web
echo "=== Checking publish dir ==="
ls -la apps/web/.next | head
echo "BUILD_OK"
