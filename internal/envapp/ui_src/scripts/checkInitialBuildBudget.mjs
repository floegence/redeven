import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { analyzeInitialBuildGraph } from './initialBuildGraphPolicy.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(scriptDir, '../../ui/dist/env');
const manifestPath = path.join(outputDir, '.vite/manifest.json');
const chunkModulesPath = path.join(outputDir, '.vite/chunk-modules.json');
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

for (const requiredPath of [manifestPath, chunkModulesPath]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Env App build output is missing: ${requiredPath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const chunkModules = JSON.parse(fs.readFileSync(chunkModulesPath, 'utf8'));
const graph = analyzeInitialBuildGraph(manifest, chunkModules);
const javascriptAssets = [...new Set(graph.javascriptAssets)];
const cssAssets = [...new Set(graph.cssAssets)];

const compressedBytes = (relativePath) => {
  const filePath = path.join(outputDir, relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`Initial build asset is missing: ${relativePath}`);
  return zlib.gzipSync(fs.readFileSync(filePath), {
    level: zlib.constants.Z_BEST_COMPRESSION,
  }).byteLength;
};

const javascriptBytes = javascriptAssets.reduce((total, asset) => total + compressedBytes(asset), 0);
const cssBytes = cssAssets.reduce((total, asset) => total + compressedBytes(asset), 0);
const totalBytes = javascriptBytes + cssBytes;
const initialAssets = [...javascriptAssets, ...cssAssets];
const forbiddenNames = forbiddenInitialAssets.filter((name) => (
  initialAssets.some((asset) => asset.toLowerCase().includes(name.toLowerCase()))
));
const forbiddenModules = graph.forbiddenModules.map((item) => (
  `forbidden initial module: ${item.path.join(' -> ')} -> ${item.moduleId}`
));
const failures = [
  javascriptBytes > budgets.javascript ? `initial JS ${javascriptBytes} > ${budgets.javascript}` : '',
  cssBytes > budgets.css ? `critical CSS ${cssBytes} > ${budgets.css}` : '',
  totalBytes > budgets.total ? `initial total ${totalBytes} > ${budgets.total}` : '',
  forbiddenNames.length > 0 ? `forbidden initial assets: ${forbiddenNames.join(', ')}` : '',
  ...forbiddenModules,
].filter(Boolean);

if (failures.length > 0) {
  throw new Error(`Env App initial build budget failed:\n${failures.join('\n')}`);
}

console.log(JSON.stringify({
  initial_javascript_gzip_bytes: javascriptBytes,
  critical_css_gzip_bytes: cssBytes,
  initial_total_gzip_bytes: totalBytes,
  initial_asset_count: initialAssets.length,
}));
