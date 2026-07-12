import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(scriptDir, '../../ui/dist/env');
const htmlPath = path.join(outputDir, 'index.html');
const budgets = {
  javascript: 600 * 1024,
  css: 120 * 1024,
  total: 720 * 1024,
};
const forbiddenInitialAssets = [
  'markdown',
  'katex',
  'mermaid',
  'monaco',
  'excel',
  'pdf',
  'shiki',
  'flower-feature',
  'codex-feature',
  'CodexPage',
  'CodexProvider',
];

if (!fs.existsSync(htmlPath)) {
  throw new Error(`Env App build output is missing: ${htmlPath}`);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const assetReferences = [...html.matchAll(/(?:src|href)="([^"]+)"/gu)]
  .map((match) => String(match[1] ?? ''))
  .filter((reference) => reference.startsWith('/_redeven_proxy/env/'));
let javascriptBytes = 0;
let cssBytes = 0;
let totalBytes = 0;

for (const reference of assetReferences) {
  const relativePath = reference.slice('/_redeven_proxy/env/'.length);
  const filePath = path.join(outputDir, relativePath);
  const compressedBytes = zlib.gzipSync(fs.readFileSync(filePath), { level: zlib.constants.Z_BEST_COMPRESSION }).byteLength;
  totalBytes += compressedBytes;
  if (reference.endsWith('.js')) javascriptBytes += compressedBytes;
  if (reference.endsWith('.css')) cssBytes += compressedBytes;
}

const forbidden = forbiddenInitialAssets.filter((name) => html.toLowerCase().includes(name.toLowerCase()));
const failures = [
  javascriptBytes > budgets.javascript ? `initial JS ${javascriptBytes} > ${budgets.javascript}` : '',
  cssBytes > budgets.css ? `critical CSS ${cssBytes} > ${budgets.css}` : '',
  totalBytes > budgets.total ? `initial total ${totalBytes} > ${budgets.total}` : '',
  forbidden.length > 0 ? `forbidden initial assets: ${forbidden.join(', ')}` : '',
].filter(Boolean);

if (failures.length > 0) {
  throw new Error(`Env App initial build budget failed:\n${failures.join('\n')}`);
}

console.log(JSON.stringify({
  initial_javascript_gzip_bytes: javascriptBytes,
  critical_css_gzip_bytes: cssBytes,
  initial_total_gzip_bytes: totalBytes,
  initial_asset_count: assetReferences.length,
}));
