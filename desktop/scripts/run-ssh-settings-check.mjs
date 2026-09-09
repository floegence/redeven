import { createSSHSettingsPreviewServer } from './ssh-settings-preview.mjs';

const server = await createSSHSettingsPreviewServer(0);
try {
  process.env.REDEVEN_SSH_PREVIEW_URL = server.resolvedUrls.local[0];
  await import('./check-ssh-settings.mjs');
} finally {
  await server.close();
}
