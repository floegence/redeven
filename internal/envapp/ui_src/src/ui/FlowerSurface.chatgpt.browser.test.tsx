import '../index.css';
import './flower-feature.css';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adapter, renderSurfaceWithAdapterProps, settingsSnapshot } from './FlowerSurface.navigation.testHarness';

it('updates authorization progress without reloading all accounts on each poll', async () => {
  await page.viewport(1280, 960);
  let ready = false;
  const saved = { account_id: 'saved', email: 'saved@example.com', state: 'ready' as const, welcome_acknowledged: true };
  const accounts = vi.fn(async () => ({ accounts: {}, saved_accounts: ready ? [saved] : [] }));
  const auth = vi.fn(async (action: string) => action === 'start' ? { id: 'attempt', state: 'waiting' as const }
    : action === 'status' ? ready ? { state: 'ready' as const, account: saved } : { state: 'waiting' as const } : {});
  const runtime = { ...adapter(), loadSettings: vi.fn(async () => ({ ...settingsSnapshot(true), auth_capabilities: { openai_chatgpt: { available: true, binding_id: 'verified' } } })), loadChatGPTAccounts: accounts, chatGPTAuth: auth };
  renderSurfaceWithAdapterProps(runtime, { settingsFocusRequest: 1 });
  await userEvent.click(page.getByRole('button', { name: 'Add provider', exact: true }));
  await userEvent.click(document.querySelector<HTMLButtonElement>('[aria-controls=flower-provider-type-openai]')!);
  await expect.poll(() => accounts.mock.calls.length).toBeGreaterThan(0);
  const before = accounts.mock.calls.length;
  await userEvent.click(page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }));
  await expect.poll(() => auth.mock.calls.filter(([action]) => action === 'status').length, { timeout: 4000 }).toBeGreaterThanOrEqual(3);
  expect(accounts.mock.calls.length).toBe(before);
  ready = true;
  await expect.element(page.getByText(saved.email, { exact: true }).last()).toBeVisible();
  await expect.poll(() => accounts.mock.calls.length).toBeGreaterThan(before);
});
