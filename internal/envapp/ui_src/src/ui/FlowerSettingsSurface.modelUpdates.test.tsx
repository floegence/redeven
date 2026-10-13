// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerSettingsSurface } from '../../../../flower_ui/src/settings/FlowerSettingsSurface';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { settingsSnapshot, waitFor } from './FlowerSurface.navigation.testHarness';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => { dispose?.(); host?.remove(); });

it.each([false, true])('discloses provider API requests before enabling automatic model updates; save fails: %s', async (fails) => {
  const [snapshot, setSnapshot] = createSignal(settingsSnapshot());
  const save = vi.fn(async (auto_update_model_catalog: boolean) => {
    if (fails) throw new Error('Could not save the setting.');
    setSnapshot(previous => ({ ...previous, defaults: { ...previous.defaults, auto_update_model_catalog } }));
    return snapshot();
  });
  host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FlowerSettingsSurface snapshot={snapshot()} copy={DEFAULT_FLOWER_SURFACE_COPY.settings}
    onSaveDefaultPermission={async () => snapshot()} onSaveModelProfile={async () => snapshot()}
    onSaveAutoUpdateModelCatalog={save} />, host);
  const toggle = host.querySelector<HTMLButtonElement>('.flower-settings-model-catalog-update-section [role="switch"]')!;
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toContain('providers’ APIs');
  expect(host.textContent).toContain('Automatic updates are off by default.');
  expect(save).not.toHaveBeenCalled();
  toggle.click();
  await waitFor(() => !toggle.disabled);
  expect(save).toHaveBeenCalledWith(true);
  expect(toggle.getAttribute('aria-checked')).toBe(String(!fails));
  if (fails) {
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not save the setting.');
  } else {
    toggle.click();
    await waitFor(() => !toggle.disabled);
    expect(save).toHaveBeenLastCalledWith(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  }
});
