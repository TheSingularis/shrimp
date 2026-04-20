#!/usr/bin/env bash
set -e

SHRIMP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

G='\033[0;32m'; N='\033[0m'
info() { echo -e "${G}[shrimp]${N} $*"; }

info "Building SHRIMP..."

# 1. Build the React frontend with Electron base paths
info "Building frontend..."
cd "$SHRIMP_DIR/frontend" && ELECTRON=1 npm run build
cd "$SHRIMP_DIR"

# 2. Run electron-builder (defaults to linux; pass --mac or --win to override)
info "Running electron-builder..."
npx electron-builder "$@"

info "Done. Check dist-electron/ for output."
