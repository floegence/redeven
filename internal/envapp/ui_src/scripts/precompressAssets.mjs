import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

// Development keeps valid compressed responses while avoiding release-level CPU
// work on every source edit. Ordinary/release builds retain maximum compression.
const profile = process.env.REDEVEN_ASSET_BUILD_PROFILE || 'release';
if (!['development', 'release'].includes(profile)) throw new Error('Unknown asset build profile: ' + profile);
const gzipLevel = profile === 'development' ? zlib.constants.Z_BEST_SPEED : zlib.constants.Z_BEST_COMPRESSION;
const brotliQuality = profile === 'development' ? 4 : zlib.constants.BROTLI_MAX_QUALITY;

// The package build holds its checkout lock through this final output stage.
const assetsDir = fileURLToPath(new URL('../../ui/dist/env/assets/', import.meta.url));
const hashAssetPattern = /-[A-Za-z0-9_-]{8,}\.(?:js|mjs|css|wasm|woff2?|ttf|otf)$/;
let rawBytes = 0;
let gzipBytes = 0;
let brotliBytes = 0;
let count = 0;

for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
  if (entry.isFile() && (entry.name.endsWith('.gz') || entry.name.endsWith('.br'))) {
    fs.unlinkSync(path.join(assetsDir, entry.name));
  }
}

for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
  if (!entry.isFile() || !hashAssetPattern.test(entry.name)) continue;
  const filePath = path.join(assetsDir, entry.name);
  const data = fs.readFileSync(filePath);
  const gzip = zlib.gzipSync(data, { level: gzipLevel });
  const brotli = zlib.brotliCompressSync(data, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality },
  });
  fs.writeFileSync(`${filePath}.gz`, gzip);
  fs.writeFileSync(`${filePath}.br`, brotli);
  rawBytes += data.byteLength;
  gzipBytes += gzip.byteLength;
  brotliBytes += brotli.byteLength;
  count += 1;
}

const fmtMiB = (value) => `${(value / 1024 / 1024).toFixed(2)} MiB`;
console.log(`precompressed ${count} assets (${profile}): ${fmtMiB(rawBytes)} raw -> gzip ${fmtMiB(gzipBytes)}, brotli ${fmtMiB(brotliBytes)}`);
