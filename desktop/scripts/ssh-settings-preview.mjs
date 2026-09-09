import { createServer } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function createSSHSettingsPreviewServer(port) {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('./fixtures/', import.meta.url)),
    plugins: [solid(), tailwindcss()],
    resolve: { dedupe: ['solid-js'] },
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      fs: { allow: [fileURLToPath(new URL('../../', import.meta.url))] },
    },
  });
  await server.listen();
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
