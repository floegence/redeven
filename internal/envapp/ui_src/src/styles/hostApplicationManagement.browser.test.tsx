import '../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { EnvHostApplicationsPage } from '../ui/pages/EnvHostApplicationsPage';

const state = vi.hoisted(() => {
  const app = { id: 'fixture', name: 'A host application with a long display name', description: '', categories: [], icon: '', custom: false };
  return { app, running: [{ application_id: app.id, instances: ['fixture-generation'] }] };
});
vi.mock('../ui/pages/EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ permissions: { can_read: true, can_write: true, can_execute: true } }),
  env_id: () => 'fixture', localRuntime: () => ({}),
}) }));
vi.mock('../ui/services/hostApplicationsApi', async importOriginal => ({
  ...await importOriginal<object>(),
  listHostApplications: async () => ({ availability: { backend: 'macos', supported: true, ready: true, native_ready: true }, applications: [state.app], sessions: [], running: state.running }),
  listHostApplicationSessions: async () => [],
  listRunningHostApplications: async () => state.running,
}));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

it.each([360, 1100])('keeps application controls and confirmation readable in a %s px surface', async width => {
  const host = document.createElement('div');
  host.style.cssText = `width:${width}px;height:680px;background:var(--background)`;
  document.body.append(host);
  dispose = render(() => <EnvHostApplicationsPage />, host);
  await expect.poll(() => host.querySelector('.host-app-quit')).toBeTruthy();
  const row = host.querySelector<HTMLElement>('.host-app-process-row')!;
  const open = row.querySelector<HTMLButtonElement>('.host-app-session-open')!;
  const quit = row.querySelector<HTMLButtonElement>('.host-app-quit')!;
  expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
  expect(open.getBoundingClientRect().right).toBeLessThanOrEqual(quit.getBoundingClientRect().left);
  expect(quit.getBoundingClientRect().height).toBeGreaterThan(24);
  expect(getComputedStyle(quit).cursor).toBe('pointer');
  await userEvent.click(quit);
  const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
  expect(dialog.textContent).toContain(state.app.name);
  expect(dialog.textContent).toContain('all of its windows');
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(500);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('[role=dialog]')).toBeNull();
  await expect.poll(() => document.activeElement).toBe(quit);
});
