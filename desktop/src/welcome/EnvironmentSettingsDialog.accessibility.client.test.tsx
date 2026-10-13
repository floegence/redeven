import { afterEach, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { createDesktopI18n } from '../shared/i18n';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import { linkedEnvironmentFixture } from '../testSupport/linkedEnvironmentFixture';
import { runtimeConnectionFixture } from '../testSupport/runtimeConnectionFixture';
import { EnvironmentSettingsDialog } from './EnvironmentSettingsDialog';
import type { EnvironmentSettingsTab } from './environmentSettingsSession';

let dispose: (() => void) | undefined;
let disposeSecond: (() => void) | undefined;
afterEach(() => {
  disposeSecond?.();
  dispose?.();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('connects retained settings panels to unique tabs and removes labels when tabs disappear', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const runtime = runtimeConnectionFixture({ kind: 'ssh_environment' }).snapshot.environments.find(entry => entry.kind === 'ssh_environment' && entry.can_edit)!;
  const [environment, setEnvironment] = createSignal<DesktopEnvironmentEntry>(runtime);
  const [tab, setTab] = createSignal<EnvironmentSettingsTab>('connection');
  const host = document.createElement('div');
  const secondHost = document.createElement('div');
  document.body.append(host, secondHost);
  dispose = render(() =>
    <EnvironmentSettingsDialog open environment={environment()} tab={tab()} i18n={createDesktopI18n('en-US')}
      onClose={() => {}} onTabChange={setTab} connection={<input aria-label="Connection draft" />} access={<input aria-label="Access draft" />} />, host);
  disposeSecond = render(() =>
    <EnvironmentSettingsDialog open environment={environment()} tab="access" i18n={createDesktopI18n('en-US')}
      onClose={() => {}} onTabChange={() => {}} connection={null} access={null} />, secondHost);
  await new Promise(resolve => setTimeout(resolve, 40));
  const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs).toHaveLength(4);
  expect(new Set(tabs.map(item => item.id)).size).toBe(4);
  for (const item of tabs) {
    expect(item.id).not.toBe('');
    const panel = document.getElementById(item.getAttribute('aria-controls')!);
    expect(panel?.getAttribute('aria-labelledby')).toBe(item.id);
  }
  disposeSecond();
  disposeSecond = undefined;
  await new Promise(resolve => setTimeout(resolve, 40));
  const first = document.querySelector('[aria-label="Connection draft"]')!.closest('.redeven-environment-settings-dialog')!;
  const accessTab = first.querySelectorAll<HTMLElement>('[role="tab"]')[1];
  accessTab.click();
  await vi.waitFor(() => expect(tab()).toBe('access'));
  const retained = first.querySelector('[aria-label="Access draft"]');
  expect(retained?.closest('[aria-hidden="true"]')).toBeNull();
  setEnvironment({ ...environment(), access_routes: [], default_access_route_missing: false,
    registration_ref: linkedEnvironmentFixture().runtime.registration_ref });
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
  expect(document.querySelectorAll('[role="tabpanel"][aria-labelledby]')).toHaveLength(0);
  expect(first.querySelector('[aria-label="Access draft"]')).toBe(retained);
});
