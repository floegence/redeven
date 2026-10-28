#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/build_center.sh <new output directory>" >&2
  exit 2
fi
OUTPUT_DIR="$1"
if [[ -e "$OUTPUT_DIR" ]]; then
  echo "Output already exists; choose a new release directory." >&2
  exit 2
fi
EXPECTED_NODE=$(cat "$ROOT_DIR/.node-version")
if [[ "$(node --version)" != "v$EXPECTED_NODE" ]]; then
  echo "Use Node.js $EXPECTED_NODE from .node-version." >&2
  exit 2
fi
corepack pnpm --dir "$ROOT_DIR/desktop" exec tsc -p tsconfig.center.json --noEmit
corepack pnpm --dir "$ROOT_DIR/desktop" exec vite build --config vite.center.config.mjs
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR=$(cd -- "$OUTPUT_DIR" && pwd)
GOWORK=off go -C "$ROOT_DIR" build -trimpath -o "$OUTPUT_DIR/redeven-center" ./cmd/redeven-center
cp -R "$ROOT_DIR/internal/envcenter_web/dist" "$OUTPUT_DIR/ui"
cp "$ROOT_DIR/packaging/center/redeven-center.service" "$OUTPUT_DIR/"
cp "$ROOT_DIR/packaging/center/redeven-center-connector.service" "$OUTPUT_DIR/"
cp "$ROOT_DIR/packaging/center/center.env.example" "$OUTPUT_DIR/"
cp "$ROOT_DIR/packaging/center/Dockerfile" "$OUTPUT_DIR/"
cp "$ROOT_DIR/packaging/center/compose.yaml" "$OUTPUT_DIR/"
node --input-type=module - "$ROOT_DIR" "$OUTPUT_DIR" <<'NODE'
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const [root, output] = process.argv.slice(2);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
const source = createHash('sha256');
for (const file of files) {
  if (!existsSync(path.join(root, file))) continue;
  source.update(file).update('\0').update(createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')).update('\0');
}
const artifacts = [];
function walk(relative = '') {
  for (const entry of readdirSync(path.join(output, relative), { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) walk(file);
    else artifacts.push({ path: file, sha256: createHash('sha256').update(readFileSync(path.join(output, file))).digest('hex') });
  }
}
walk();
const manifest = { built_at: new Date().toISOString(), base_commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0, source_sha256: source.digest('hex'), source_algorithm: 'sorted git tracked and nonignored untracked existing files: path NUL sha256(bytes) NUL', node: process.version, pnpm: execFileSync('corepack', ['pnpm','--version'], {cwd:path.join(root,'desktop'),encoding:'utf8'}).trim(), go: execFileSync('go',['version'],{encoding:'utf8'}).trim(), target: JSON.parse(execFileSync('go',['env','-json','GOOS','GOARCH'],{encoding:'utf8'})), artifacts };
writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
NODE
printf 'Built independent Center in %s\n' "$OUTPUT_DIR"
