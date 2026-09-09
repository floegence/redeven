import { createServer } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL('./fixtures/', import.meta.url)),
  plugins: [solid(), tailwindcss()],
  resolve: { dedupe: ['solid-js'] },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.REDEVEN_SSH_PREVIEW_PORT || 43817),
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('../../', import.meta.url))] },
  },
});
await server.listen();
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
