const allowedFloetermInitialModules = new Set([
  '@floegence/floeterm-terminal-web/dist/entries/sessions.js',
  '@floegence/floeterm-terminal-web/dist/sessions/TerminalForegroundCommandMetadata.js',
  '@floegence/floeterm-terminal-web/dist/sessions/TerminalSessionsCoordinator.js',
  '@floegence/floeterm-terminal-web/dist/utils/logger.js',
]);

function isForbiddenInitialModule(moduleId) {
  if (moduleId.startsWith('@floegence/floeterm-terminal-web/')) {
    return !allowedFloetermInitialModules.has(moduleId);
  }
  return moduleId === 'ghostty-web'
    || moduleId.startsWith('ghostty-web/')
    || moduleId === '@floegence/beamterm-renderer'
    || moduleId.startsWith('@floegence/beamterm-renderer/')
    || moduleId === '@beamterm/renderer'
    || moduleId.startsWith('@beamterm/renderer/');
}

export function analyzeInitialBuildGraph(manifest, chunkModules) {
  const entries = Object.entries(manifest).filter(([, item]) => item?.isEntry === true);
  if (entries.length === 0) throw new Error('Vite manifest does not contain an entry chunk');

  const visited = new Set();
  const paths = new Map();
  const queue = entries.map(([key]) => {
    paths.set(key, [key]);
    return key;
  });
  while (queue.length > 0) {
    const key = queue.shift();
    if (visited.has(key)) continue;
    const item = manifest[key];
    if (!item || typeof item.file !== 'string') {
      throw new Error(`Vite manifest entry is missing or invalid: ${key}`);
    }
    visited.add(key);
    for (const importedKey of item.imports ?? []) {
      if (!manifest[importedKey]) {
        throw new Error(`Vite manifest import is missing: ${key} -> ${importedKey}`);
      }
      if (!paths.has(importedKey)) {
        paths.set(importedKey, [...(paths.get(key) ?? [key]), importedKey]);
      }
      queue.push(importedKey);
    }
  }

  const javascriptAssets = new Set();
  const cssAssets = new Set();
  const forbiddenModules = [];
  for (const key of visited) {
    const item = manifest[key];
    javascriptAssets.add(item.file);
    for (const css of item.css ?? []) cssAssets.add(css);

    const chunk = chunkModules.chunks?.[item.file];
    if (!chunk || !Array.isArray(chunk.modules)) {
      throw new Error(`Chunk module manifest is missing the initial asset: ${item.file}`);
    }
    for (const moduleId of chunk.modules) {
      if (!isForbiddenInitialModule(moduleId)) continue;
      forbiddenModules.push({
        asset: item.file,
        moduleId,
        path: (paths.get(key) ?? [key]).map((pathKey) => manifest[pathKey]?.file ?? pathKey),
      });
    }
  }

  return {
    javascriptAssets: [...javascriptAssets],
    cssAssets: [...cssAssets],
    forbiddenModules,
  };
}
