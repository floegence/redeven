import path from 'node:path';
import { fileURLToPath } from 'node:url';
import welcome from './vite.welcome.config.mjs';
const desktop = path.dirname(fileURLToPath(import.meta.url));
export default {
  ...welcome,
  root: path.resolve(desktop, '../internal/envcenter_web'),
  base: '/',
  resolve: { ...welcome.resolve, alias: [...welcome.resolve.alias,
    { find: /^qrcode-generator$/, replacement: path.resolve(desktop, 'node_modules/qrcode-generator/dist/qrcode.mjs') },
    { find: /^solid-js$/, replacement: path.resolve(desktop, 'node_modules/solid-js/dist/solid.js') },
    { find: /^solid-js\/web$/, replacement: path.resolve(desktop, 'node_modules/solid-js/web/dist/web.js') },
    { find: /^solid-js\/store$/, replacement: path.resolve(desktop, 'node_modules/solid-js/store/dist/store.js') },
  ] },
  build: { outDir: path.resolve(desktop, '../internal/envcenter_web/dist'), emptyOutDir: true },
};
