import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  analyzeInitialBuildGraph,
  findForbiddenInitialAssetNames,
} from './initialBuildGraphPolicy.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(scriptDir, '../../ui/dist/env');
const manifestPath = path.join(outputDir, '.vite/manifest.json');
const chunkModulesPath = path.join(outputDir, '.vite/chunk-modules.json');
const budgets = {
  // Floe Webapp 0.52.7 adds 319 gzip bytes to the existing initial graph.
  // Keep a small bounded margin for that published dependency baseline while
  // retaining the forbidden-module and total-size guards below.
  javascript: 602 * 1024,
  // Floe 0.79 adds shared adaptive navigation and left-drawer styles. Keep the
  // updated CSS baseline bounded; the total and forbidden-module limits remain.
  css: 121 * 1024,
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
];

for (const requiredPath of [manifestPath, chunkModulesPath]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`Env App build output is missing: ${requiredPath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const chunkModules = JSON.parse(fs.readFileSync(chunkModulesPath, 'utf8'));
const compressedBytes = (relativePath) => {
  const filePath = path.join(outputDir, relativePath);
  if (!fs.existsSync(filePath)) throw new Error(`Initial build asset is missing: ${relativePath}`);
  return zlib.gzipSync(fs.readFileSync(filePath), {
    level: zlib.constants.Z_BEST_COMPRESSION,
  }).byteLength;
};

// Each document loads its own static graph. Shared assets count against every
// document that imports them; independent windows never share one size budget.
for (const required of ['index.html', 'access.html', 'browser.html']) {
  if (manifest[required]?.isEntry !== true || !fs.existsSync(path.join(outputDir, required))) {
    throw new Error(`Env App build output is missing document: ${required}`);
  }
}
for (const [entry, item] of Object.entries(manifest)) {
  if (!item.isEntry) continue;
  const graph = analyzeInitialBuildGraph(manifest, chunkModules, entry);
  const javascriptAssets = [...new Set(graph.javascriptAssets)];
  const cssAssets = [...new Set(graph.cssAssets)];
  const javascriptBytes = javascriptAssets.reduce((total, asset) => total + compressedBytes(asset), 0);
  const cssBytes = cssAssets.reduce((total, asset) => total + compressedBytes(asset), 0);
  const totalBytes = javascriptBytes + cssBytes;
  const initialAssets = [...javascriptAssets, ...cssAssets];
  const forbiddenNames = findForbiddenInitialAssetNames(initialAssets, forbiddenInitialAssets);
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
    throw new Error(`Env App ${entry} initial build budget failed:\n${failures.join('\n')}`);
  }

  console.log(JSON.stringify({
    entry,
    initial_javascript_gzip_bytes: javascriptBytes,
    critical_css_gzip_bytes: cssBytes,
    initial_total_gzip_bytes: totalBytes,
    initial_asset_count: initialAssets.length,
  }));
}
