// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { bindSessionHTTP } from '../services/sessionHTTP';
import { installAuthorArtifact } from './pluginAuthorApi';
let release: (() => void) | undefined;
afterEach(() => release?.());
it('preserves the platform mutation outcome from its nested error envelope', async () => {
  const fetch = vi.fn(async () => Response.json({ ok: false, error: { code: 'PLUGIN_INSPECTION_EXPIRED', message: 'Expired', mutation_outcome: 'not_committed' } }, { status: 409 }));
  release = bindSessionHTTP({ fetch, events: async function* () {} });
  await expect(installAuthorArtifact('workspace', 'artifact', 'review', 'request', 1)).rejects.toMatchObject({ code: 'PLUGIN_INSPECTION_EXPIRED', mutationOutcome: 'not_committed' });
});
