import { createServer } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import welcomeConfig from '../vite.welcome.config.mjs';

export async function createSSHSettingsPreviewServer(port) {
  // Vite treats zero as its default port; choose an isolated port explicitly.
  if (port === 0) {
    const probe = net.createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    port = probe.address().port;
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
  const cacheDir = await mkdtemp(join(tmpdir(), 'redeven-settings-preview-'));
  const server = await createServer({
    cacheDir,
    configFile: false,
    root: fileURLToPath(new URL('./fixtures/', import.meta.url)),
    plugins: [solid(), tailwindcss()],
    resolve: welcomeConfig.resolve,
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      fs: { allow: [fileURLToPath(new URL('../../', import.meta.url))] },
    },
  });
  const close = server.close.bind(server);
  server.close = async () => { try { await close(); } finally { await rm(cacheDir, { recursive: true, force: true }); } };
  try { await server.listen(); } catch (error) { await server.close(); throw error; }
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createSSHSettingsPreviewServer(Number(process.env.REDEVEN_SSH_PREVIEW_PORT || 43817));
  server.printUrls();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await server.close();
      process.exit(0);
    });
  }
}
