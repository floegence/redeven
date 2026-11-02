import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function findUnapprovedWasmAssets(directory) {
  const publishedAssets = [
    { name: /^libavoid-[A-Za-z0-9_-]{8,}\.wasm$/u, entry: '@floegence/floe-webapp-core/graph', file: 'libavoid.wasm' },
    { name: /^xlsx_parser_bg-[A-Za-z0-9_-]{8,}\.wasm$/u, entry: '@silurus/ooxml/xlsx', file: 'xlsx_parser_bg.wasm' },
  ];
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const approved = await Promise.all(publishedAssets.map(async asset => ({
    name: asset.name,
    hash: digest(await readFile(path.join(path.dirname(fileURLToPath(import.meta.resolve(asset.entry))), asset.file))),
  })));
  const rejected = [];
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.wasm'))) {
    const hash = digest(await readFile(path.join(directory, name)));
    if (!approved.some(asset => asset.name.test(name) && asset.hash === hash)) rejected.push(name);
  }
  return rejected.sort();
}
