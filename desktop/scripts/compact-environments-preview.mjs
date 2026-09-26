import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import welcomeConfig from '../vite.welcome.config.mjs';
import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const output = process.env.REDEVEN_COMPACT_PREVIEW_OUTPUT;
const server = await createSSHSettingsPreviewServer(output ? 0 : Number(process.env.REDEVEN_COMPACT_PREVIEW_PORT || 43829));
try {
  const { compactEnvironmentPreviewFixture } = await server.ssrLoadModule(fileURLToPath(new URL('../src/testSupport/compactEnvironmentPreviewFixture.ts', import.meta.url)));
  await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
  await writeFile(new URL('../dist/compact-preview-fixtures.json', import.meta.url), JSON.stringify(compactEnvironmentPreviewFixture()));
  if (output) {
    await server.close();
    await build({ ...welcomeConfig, configFile: false, root: fileURLToPath(new URL('./fixtures/', import.meta.url)),
      build: { outDir: output, emptyOutDir: true, rollupOptions: { input: fileURLToPath(new URL('./fixtures/compact-environments.html', import.meta.url)) } },
    });
  } else {
    server.printUrls();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
  }
} catch (error) { await server.close(); throw error; }
