import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, preview } from 'vite';
import { build as bundleNode } from 'esbuild';
import welcomeConfig from '../vite.welcome.config.mjs';

// Native acceptance uses the built renderer without a development optimizer or
// hot-reload connection. The session owns every generated file and listener.
export async function createBuiltFlowerPreview(session, state) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const fixtureRoot = path.join(root, 'desktop/scripts/fixtures');
  const fixtureDist = path.join(state, 'renderer');
  await build({ ...welcomeConfig, configFile: false, root: fixtureRoot, base: './',
    build: { outDir: fixtureDist, emptyOutDir: true, rolldownOptions: { input: path.join(fixtureRoot, 'flower-navigation.html') } } });
  const server = await preview({ configFile: false, root: fixtureRoot, build: { outDir: fixtureDist }, preview: { host: '127.0.0.1', port: 0 } });
  await session.defer('Flower preview server', () => new Promise((resolve, reject) => {
    server.httpServer.closeAllConnections();
    server.httpServer.close(error => error ? reject(error) : resolve());
  }));
  await session.port(server.httpServer.address().port);
  const snapshotModule = path.join(state, 'snapshot.mjs');
  await bundleNode({ stdin: { contents: "export { mixedEnvironmentFixture } from './desktop/src/testSupport/mixedEnvironmentFixture'; export { RUNTIME_SERVICE_COMPATIBILITY_EPOCH, RUNTIME_SERVICE_PROTOCOL_VERSION } from './desktop/src/shared/runtimeService';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: snapshotModule });
  return { url: server.resolvedUrls.local[0], ...await import(pathToFileURL(snapshotModule).href) };
}
