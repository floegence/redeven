import '../index.css';
import './flower-feature.css';

import { expect, it, vi } from 'vitest';
import { adapter, renderSurfaceWithAdapter, waitFor } from './FlowerSurface.navigation.testHarness';

it('loads settings on first use and preserves the mounted panel when returning to chat', async () => {
  const runtime = renderSurfaceWithAdapter(adapter(true));
  await waitFor(() => Boolean(runtime.querySelector('button[aria-label="Flower settings"]')));
  expect(runtime.querySelector('.flower-settings-providers-section')).toBeNull();

  (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
  await waitFor(() => Boolean(runtime.querySelector('.flower-settings-providers-section')));
  const providers = runtime.querySelector('.flower-settings-providers-section')!;
  expect(providers.textContent).toContain('OpenAI');

  (runtime.querySelector('button[aria-label="Back to chat"]') as HTMLButtonElement).click();
  await waitFor(() => Boolean(runtime.querySelector('.flower-chat-shell')));
  expect(providers.isConnected).toBe(true);
  (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
  expect(runtime.querySelector('.flower-settings-providers-section')).toBe(providers);
});

it('retains the browser address and reports failed readiness without exposing transport details', async () => {
  const connect = vi.fn().mockResolvedValue({ id: 'browser-connected', kind: 'browser.connected', display_name: 'Connected Chrome', ready: false, state: 'connection_required' });
  const listBrowserTabs = vi.fn().mockResolvedValue([{ id: 'tab-one', profile_id: 'personal', title: 'Example', url: 'https://example.com' }]);
  const runtime = renderSurfaceWithAdapter({ ...adapter(true), connectComputerBrowser: connect, computerManagement: { listCandidates: vi.fn().mockResolvedValue({current_target_id:"",candidates:[]}), selectCandidate:vi.fn(),
    listTargets: vi.fn().mockResolvedValue([]), listBrowserTabs,
    loadAccess: vi.fn().mockResolvedValue({ origins: [], apps: [], allow_foreground: false }), saveAccess: vi.fn(),
    loadTarget: vi.fn().mockResolvedValue({ target_id: '' }), selectTarget: vi.fn(),
  } });
  await waitFor(() => Boolean(runtime.querySelector('button[aria-label="Flower settings"]')));
  (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
  await waitFor(() => Boolean(runtime.querySelector('.flower-settings-computer-connect-section input')));
  const section = runtime.querySelector('.flower-settings-computer-connect-section')!;
  const input = section.querySelector('input')!;
  input.value = 'http://127.0.0.1:9222';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  (section.querySelector('button') as HTMLButtonElement).click();
  await waitFor(() => section.querySelectorAll('select').length === 2);
  expect(connect).not.toHaveBeenCalled();
  const [profile, tab] = Array.from(section.querySelectorAll('select'));
  profile.value = 'personal'; profile.dispatchEvent(new Event('change', { bubbles: true }));
  tab.value = 'tab-one'; tab.dispatchEvent(new Event('change', { bubbles: true }));
  const connectButton = () => Array.from(section.querySelectorAll('button')).find(button => button.textContent === 'Connect tab')!;
  connectButton().click();
  expect(connect).toHaveBeenCalledWith({ cdp_url: 'http://127.0.0.1:9222', profile_id: 'personal', tab_id: 'tab-one' });
  await waitFor(() => Boolean(section.querySelector('[role="alert"]')));
  expect(input.value).toBe('http://127.0.0.1:9222');
  expect(section.textContent).toContain('Unable to update the connection.');
  connect.mockRejectedValueOnce(new Error('Authorization: private-connection-secret'));
  connectButton().click();
  await waitFor(() => connect.mock.calls.length === 2);
  await waitFor(() => !(section.querySelector('button') as HTMLButtonElement).disabled);
  expect(section.textContent).not.toContain('private-connection-secret');
});
