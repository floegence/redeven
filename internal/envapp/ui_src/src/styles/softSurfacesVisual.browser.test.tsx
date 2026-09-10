import '../index.css';
import '../ui/flower-feature.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { Card, Dialog, Input, RadioList, Switch } from '@floegence/floe-webapp-core/ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { WindowModal } from '../ui/widgets/WindowModal';
import { EnvDebugConsoleSettingsPanel } from '../ui/pages/EnvDebugConsoleSettingsPanel';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

it.each(['light', 'dark'] as const)('keeps real product controls crisp and overlays separated in %s mode', async (mode) => {
  await page.viewport(1000, 900);
  const host = document.createElement('main');
  document.body.appendChild(host);
  let localHost: HTMLDivElement | undefined;
  const [open, setOpen] = createSignal(false);
  const [enabled, setEnabled] = createSignal(false);
  dispose = render(() => (
    <FloeProvider config={{ storage: { enabled: false }, theme: { defaultTheme: mode, defaultSurfaceStyle: 'soft-neumorphic' } }}>
      <div style={{ padding: '24px', width: '640px', background: 'var(--background)' }}>
        <Card><RadioList options={[{ value: 'local', label: 'Local' }, { value: 'cloud', label: 'Cloud' }]} value="local" onChange={() => undefined} />
          <Switch aria-label="Sync" checked={enabled()} onChange={setEnabled} />
          <Input aria-label="Workspace" value="draft workspace" />
        </Card>
        <EnvDebugConsoleSettingsPanel enabled={enabled()} canInteract onEnabledChange={setEnabled} />
        <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
        <Dialog open={open()} onOpenChange={setOpen} title="Environment settings"><Input aria-label="Dialog name" /></Dialog>
        <div ref={localHost} style={{ position: 'relative', width: '600px', height: '320px' }}>
          <WindowModal open host={localHost} title="Local action" onOpenChange={() => undefined} />
        </div>
      </div>
    </FloeProvider>
  ), host);
  await expect.poll(() => document.documentElement.dataset.floeSurfaceStyle).toBe('soft-neumorphic');
  const radio = host.querySelectorAll<HTMLElement>('[data-floe-surface-part="indicator"]')[1]!;
  expect(getComputedStyle(radio).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(getComputedStyle(radio).borderWidth).toBe('1px');
  const thumb = host.querySelector<HTMLElement>('[data-floe-surface-part="switch-thumb"]')!;
  const before = getComputedStyle(thumb).backgroundColor;
  await page.elementLocator(thumb.parentElement!).click();
  expect(enabled()).toBe(true);
  expect(getComputedStyle(thumb).backgroundColor).toBe(before);
  expect(getComputedStyle(thumb).transitionProperty).toBe('translate');

  const localDialog = host.querySelector<HTMLElement>('[data-testid="window-modal-overlay"] [role="dialog"]')!;
  expect(localHost?.contains(localDialog)).toBe(true);
  expect(localDialog.style.position).not.toBe('fixed');
  expect(localDialog.dataset.floeSurface).toBe('floating');
  expect(getComputedStyle(host.querySelector<HTMLElement>('[data-testid="window-modal-backdrop"]')!).backdropFilter).toBe('none');
  expect(getComputedStyle(localDialog).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  if (mode === 'dark') expect(getComputedStyle(localDialog).backgroundColor).not.toBe(getComputedStyle(host.firstElementChild!).backgroundColor);

  await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
  const dialog = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
  await expect.poll(() => dialog.getBoundingClientRect().width).toBeGreaterThan(0);
  await expect.poll(() => getComputedStyle(dialog).opacity).toBe('1');
  expect(getComputedStyle(document.querySelector<HTMLElement>('[data-floe-dialog-backdrop]')!).backdropFilter).toBe('none');
  expect(getComputedStyle(dialog).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  const field = dialog.querySelector<HTMLInputElement>('input')!;
  const bounds = field.getBoundingClientRect();
  field.value = 'Preserved draft';
  field.focus();
  field.setSelectionRange(2, 9);
  expect(field.selectionStart).toBe(2);
  expect(field.selectionEnd).toBe(9);
  expect(field.getBoundingClientRect().width).toBe(bounds.width);
  expect((await page.screenshot({ save: false })).length).toBeGreaterThan(400);
});
