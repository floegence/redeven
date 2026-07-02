#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

source "$SCRIPT_DIR/ui_package_common.sh"

build_envapp_ui() {
  local dir="$ROOT_DIR/internal/envapp/ui_src"
  if [ ! -d "$dir" ]; then
    log "Env App UI: skipped (missing: $dir)"
    return 0
  fi

  ui_pkg_log ""
  ui_pkg_log "Env App UI: building..."
  (
    cd "$dir"
    # Clear Vite pre-bundle cache so upgraded dependencies in node_modules are rebuilt.
    rm -rf node_modules/.vite 2>/dev/null || true
    if ui_pkg_need_install "$dir"; then
      ui_pkg_run_pnpm install --frozen-lockfile
    fi
    ui_pkg_run_pnpm build
  )
  compress_envapp_assets
  ui_pkg_log "Env App UI: done."
}

compress_envapp_assets() {
  local assets_dir="$ROOT_DIR/internal/envapp/ui/dist/env/assets"
  if [ ! -d "$assets_dir" ]; then
    ui_pkg_die "Env App UI assets directory missing after build: $assets_dir"
  fi

  ui_pkg_log "Env App UI: precompressing hashed assets..."
  node - "$assets_dir" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const assetsDir = process.argv[2];
const hashAssetPattern = /-[A-Za-z0-9_-]{8,}\.(?:js|mjs|css|wasm|woff2?|ttf|otf)$/;
let rawBytes = 0;
let gzipBytes = 0;
let brotliBytes = 0;
let gzipCount = 0;
let brotliCount = 0;

for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (entry.name.endsWith('.gz') || entry.name.endsWith('.br')) {
    fs.unlinkSync(path.join(assetsDir, entry.name));
  }
}

for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
  if (!entry.isFile() || !hashAssetPattern.test(entry.name)) continue;
  const filePath = path.join(assetsDir, entry.name);
  const data = fs.readFileSync(filePath);
  rawBytes += data.byteLength;

  const gzip = zlib.gzipSync(data, { level: zlib.constants.Z_BEST_COMPRESSION });
  fs.writeFileSync(`${filePath}.gz`, gzip);
  gzipBytes += gzip.byteLength;
  gzipCount += 1;

  if (typeof zlib.brotliCompressSync === 'function') {
    const brotli = zlib.brotliCompressSync(data, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
      },
    });
    fs.writeFileSync(`${filePath}.br`, brotli);
    brotliBytes += brotli.byteLength;
    brotliCount += 1;
  }
}

const fmtMiB = (value) => `${(value / 1024 / 1024).toFixed(2)} MiB`;
const details = [`gzip ${gzipCount} files ${fmtMiB(gzipBytes)}`];
if (brotliCount > 0) details.push(`brotli ${brotliCount} files ${fmtMiB(brotliBytes)}`);
console.log(`precompressed ${fmtMiB(rawBytes)} raw -> ${details.join(', ')}`);
NODE
}

build_codeapp_ui() {
  local dir="$ROOT_DIR/internal/codeapp/ui_src"
  if [ ! -d "$dir" ]; then
    log "Code App UI: skipped (missing: $dir)"
    return 0
  fi

  if ! command -v npm >/dev/null 2>&1; then
    ui_pkg_die "npm not found (install Node.js)"
  fi

  ui_pkg_log ""
  ui_pkg_log "Code App UI: building..."
  (
    cd "$dir"
    if ui_pkg_need_install "$dir"; then
      npm ci --no-audit --no-fund
    fi
    npm run --silent build
  )
  ui_pkg_log "Code App UI: done."
}

build_okf_bundle() {
  local script="$ROOT_DIR/scripts/build_okf_bundle.sh"
  if [ ! -x "$script" ]; then
    ui_pkg_die "missing executable OKF bundle builder: $script"
  fi

  ui_pkg_log ""
  ui_pkg_log "OKF bundle: building..."
  "$script"
  ui_pkg_log "OKF bundle: done."
}

verify_third_party_notices() {
  local script="$ROOT_DIR/scripts/generate_third_party_notices.mjs"
  if [ ! -f "$script" ]; then
    ui_pkg_die "missing third-party notice generator: $script"
  fi
  if ! command -v node >/dev/null 2>&1; then
    ui_pkg_die "node not found (required to verify third-party notices)"
  fi

  ui_pkg_log ""
  ui_pkg_log "Third-party notices: verifying..."
  node "$script" --check
  ui_pkg_log "Third-party notices: done."
}

main() {
  ui_pkg_log "Building redeven embedded assets..."
  ui_pkg_log "ROOT_DIR: $ROOT_DIR"
  if [ "${REDEVEN_AGENT_FORCE_INSTALL:-}" = "1" ]; then
    ui_pkg_log "REDEVEN_AGENT_FORCE_INSTALL=1 (dependency reinstall enabled)"
  fi

  build_envapp_ui
  build_codeapp_ui
  build_okf_bundle
  verify_third_party_notices

  ui_pkg_log ""
  ui_pkg_log "All embedded assets built."
}

main "$@"
