import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { AuditLogDialog } from './AuditLogDialog';

const state = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../services/auditApi', () => ({ listAgentAuditLogs: state.list }));
vi.mock('@floegence/floe-webapp-core', async original => ({ ...await original<object>(), useNotification: () => ({ success: vi.fn(), error: vi.fn() }) }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); state.list.mockReset(); });
function mount() {
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <AuditLogDialog open envId="environment" onClose={() => {}} />, root);
}
const entry = { env_public_id: 'environment', user_email: 'reader@example.com', created_at: '2026-09-27T00:00:00Z', action: 'session_opened', kind: 'envapp_rpc', can_read: true };
it('retains audit rows through failure and retries from the existing footer', async () => {
  state.list.mockResolvedValue([entry]); mount();
  await expect.poll(() => document.querySelector('tbody tr')).toBeTruthy();
  const row = document.querySelector('tbody tr')!;
  await new Promise(resolve => setTimeout(resolve, 300));
  const geometry = row.getBoundingClientRect().toJSON();
  state.list.mockRejectedValue(new Error('Audit unavailable'));
  await userEvent.click(page.getByRole('button', { name: 'Refresh', exact: true }));
  const trigger = document.querySelector<HTMLButtonElement>('[data-floe-status-indicator] button')!;
  await expect.poll(() => trigger.getAttribute('aria-label')).toContain('Audit unavailable');
  expect(document.querySelector('tbody tr')).toBe(row);
  expect(row.getBoundingClientRect().toJSON()).toEqual(geometry);
  await userEvent.click(trigger);
  await expect.poll(() => document.querySelector('[data-floe-status-details]')?.textContent).toContain('Audit unavailable');
  await userEvent.keyboard('{Escape}');
  state.list.mockResolvedValue([entry]);
  await userEvent.click(page.getByRole('button', { name: 'Refresh', exact: true }));
  await expect.poll(() => trigger.getAttribute('aria-hidden')).toBe('true');
  expect(document.querySelector('tbody tr')).toBe(row);
});
it('shows first-load failure directly instead of an empty audit history', async () => {
  state.list.mockRejectedValue(new Error('Audit unavailable')); mount();
  await expect.poll(() => [...document.querySelectorAll('[role="alert"]')].some(node => node.textContent === 'Audit unavailable' && (node as HTMLElement).checkVisibility())).toBe(true);
  expect(document.querySelector('table')).toBeNull();
  state.list.mockResolvedValue([entry]);
  await userEvent.click(page.getByRole('button', { name: 'Refresh', exact: true }));
  await expect.poll(() => document.querySelector('tbody tr')).toBeTruthy();
});
