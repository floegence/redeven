import { afterEach, expect, it, vi } from 'vitest';
import { bindSessionHTTP } from '../services/sessionHTTP';
import { createPluginDraft, listPluginDrafts, renamePluginDraft, type PluginDraft } from './pluginCreationApi';

let release: (() => void) | undefined;
afterEach(() => { release?.(); vi.unstubAllGlobals(); });
it('sends draft operations through the current authenticated environment transport', async () => {
  const draft: PluginDraft = { id: 'draft', title: 'Timer', revision: 1, lifecycle: 'active', created_at: 1, updated_at: 1 };
  const direct = vi.fn(async () => { throw new Error('browser origin is not the remote environment'); });
  vi.stubGlobal('fetch', direct);
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => Response.json({ ok: true, data: init?.method === 'GET' && String(input).endsWith('/drafts') ? [draft] : draft }));
  release = bindSessionHTTP({ fetch: transport, events: async function* () {} });
  await expect(createPluginDraft('request')).resolves.toEqual(draft);
  await expect(listPluginDrafts()).resolves.toEqual([draft]);
  await expect(renamePluginDraft(draft, 'Focus')).resolves.toEqual(draft);
  expect(direct).not.toHaveBeenCalled();
  const [, init] = transport.mock.calls.find(([path]) => String(path).endsWith('/rename'))!;
  expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
  expect(JSON.parse(String(init?.body))).toEqual({ revision: 1, title: 'Focus' });
});
