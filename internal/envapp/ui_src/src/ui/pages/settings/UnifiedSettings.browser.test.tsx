import '../../../index.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { For, Show, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { SettingsDialog } from '../../../../../../settings_ui/src/SettingsDialog';
import { createSettingsSession } from '../../../../../../settings_ui/src/settingsSession';
import { HostedSettingsPanel, SettingsPanelContext, type SettingsPanelRegistration } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { ActivityPluginSurfaceWindow } from '../../plugins/ActivityPluginSurfaceWindow';
import { EnvAppFloatingWindowStackProvider } from '../../context/EnvAppFloatingWindowStackContext';
vi.mock('../../plugins/PluginSurfaceFrame', () => ({
  PluginSurfaceBody: () => <iframe title="Plugin content" srcdoc="<button>Plugin action</button>" style={{ width: '100%', height: '100%' }} />,
}));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

it.each([1280, 390])('retains work and resource drafts in one global dialog at %ipx', async width => {
  await page.viewport(width, 850);
  const host = document.createElement('div'); document.body.append(host);
  let session!: ReturnType<typeof createSettingsSession>;
  let panels!: () => readonly SettingsPanelRegistration[];
  let resourceOpen!: () => boolean;
  let setThread!: (value: string) => void;
  let underlying!: HTMLInputElement;
  dispose = render(() => {
    session = createSettingsSession();
    const [entries, setEntries] = createSignal<readonly SettingsPanelRegistration[]>([]); panels = entries;
    const [open, setOpen] = createSignal(false); resourceOpen = open;
    const [thread, updateThread] = createSignal('thread-a'); setThread = updateThread;
    const registry = { ...session, register: (entry: SettingsPanelRegistration) => { setEntries(items => [...items, entry]); return () => setEntries(items => items.filter(item => item !== entry)); } };
    return <FloeProvider><SettingsPanelContext.Provider value={registry}>
      <div style={{ transform: 'translateX(0)', position: 'relative', 'z-index': 3000 }}>
        <input ref={underlying} aria-label="Work draft" value="work stays" />
        <button onClick={() => setOpen(true)}>Open resource</button>
        <HostedSettingsPanel open={open()} target={{ section: 'browser', resource: thread() }} onClose={() => setOpen(false)} fallback={body => body}><input aria-label="Resource draft" value="original" /></HostedSettingsPanel>
      </div>
      <SettingsDialog globalZIndex={4000} open={session.target() !== null} present={session.present()} onPresenceChange={session.setPresent} onClose={session.close} title="Settings" closeLabel="Close settings">
        <div><button onClick={() => session.open({ section: 'appearance' })}>Appearance</button><button onClick={() => session.open({ section: 'browser', resource: 'thread-a' })}>Resource</button>
          <For each={entries()}>{entry => <Show when={session.present() && session.target()?.section === entry.target.section && session.target()?.resource === entry.target.resource}>{entry.render()}</Show>}</For>
        </div>
      </SettingsDialog>
    </SettingsPanelContext.Provider></FloeProvider>;
  }, host);
  await page.getByRole('button', { name: 'Open resource', exact: true }).click();
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  await page.getByRole('textbox', { name: 'Resource draft' }).fill('kept');
  const draft = document.querySelector<HTMLInputElement>('[aria-label="Resource draft"]')!;
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: 'Resource', exact: true }).click();
  await expect.element(page.getByRole('textbox', { name: 'Resource draft' })).toBeVisible();
  expect(document.querySelector('[aria-label="Resource draft"]')).toBe(draft);
  expect(draft.value).toBe('kept'); expect(underlying.value).toBe('work stays');
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.getBoundingClientRect().width).toBeLessThanOrEqual(width);
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect.poll(resourceOpen).toBe(false);
  expect(panels()).toHaveLength(0);
  setThread('thread-b');
  expect(session.target()).toBeNull();
  session.open({ section: 'browser', resource: 'thread-a' });
  expect(panels()).toHaveLength(0);
  expect(document.querySelector('[aria-label="Resource draft"]')).toBeNull();
  session.close();
  await expect.poll(() => session.present()).toBe(false);
  await page.getByRole('button', { name: 'Open resource', exact: true }).click();
  await expect.element(page.getByRole('textbox', { name: 'Resource draft' })).toBeVisible();
  expect(panels()[0].target.resource).toBe('thread-b');
  expect(draft.value).toBe('kept');
});


it.each([1280, 390])('hands modal focus and pointer access to a retained Activity plugin at %ipx', async width => {
  await page.viewport(width, 850);
  const host = document.createElement('div'); document.body.append(host);
  let session!: ReturnType<typeof createSettingsSession>;
  const target = { pluginID: 'com.example.metrics', pluginInstanceID: 'metrics', surfaceID: 'dashboard', expectedManagementRevision: 1, displayName: 'Metrics' };
  const windowProps = { instanceID: 'settings-handoff-plugin', target,
    coordinator: {} as Parameters<typeof ActivityPluginSurfaceWindow>[0]['coordinator'],
    confirmationQueue: {} as Parameters<typeof ActivityPluginSurfaceWindow>[0]['confirmationQueue'],
    onActivate: () => {}, onClosed: () => {}, onEndPluginSession: async () => true, onRetirementError: () => {},
  };
  dispose = render(() => {
    session = createSettingsSession();
    const [admitted, setAdmitted] = createSignal(false);
    return <FloeProvider><EnvAppFloatingWindowStackProvider>
      <button onClick={() => session.open({ section: 'plugins' })}>Open settings</button>
      <Show when={admitted()}><ActivityPluginSurfaceWindow {...windowProps} visible={!session.present()} active={!session.present()} focusRequest={1} /></Show>
      <SettingsDialog globalZIndex={4000} open={session.target() !== null} present={session.present()} onPresenceChange={session.setPresent} onClose={session.close} title="Settings" closeLabel="Close settings">
        <button onClick={() => { setAdmitted(true); session.close(); }}>Open plugin</button>
      </SettingsDialog>
    </EnvAppFloatingWindowStackProvider></FloeProvider>;
  }, host);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await page.getByRole('button', { name: 'Open plugin', exact: true }).click();
  await expect.poll(() => session.present()).toBe(false);
  const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Plugin content"]')!;
  await expect.poll(() => document.activeElement).toBe(frame);
  const isHit = () => {
    const box = frame.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === frame;
  };
  await expect.poll(isHit).toBe(true);
  session.open({ section: 'plugins' });
  await expect.element(page.getByRole('button', { name: 'Open plugin', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open plugin', exact: true }).click();
  await expect.poll(() => session.present()).toBe(false);
  expect(document.querySelector('iframe[title="Plugin content"]')).toBe(frame);
  await expect.poll(isHit).toBe(true);
  await expect.poll(() => document.activeElement).toBe(frame);
});
