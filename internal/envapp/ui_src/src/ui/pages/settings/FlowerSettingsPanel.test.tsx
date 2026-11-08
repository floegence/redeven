// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowerSettingsPanel } from '../../../../../../flower_ui/src/settings/FlowerSettingsPanel';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../../../flower_ui/src/copy';
import type { FlowerSettingsSurfaceProps } from '../../../../../../flower_ui/src/settings/FlowerSettingsSurface';
import type { FlowerModelDirectory, FlowerSurfaceAdapter } from '../../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { settingsSnapshot } from '../../FlowerSurface.navigation.testHarness';
let surface!: FlowerSettingsSurfaceProps;
vi.mock('../../../../../../flower_ui/src/settings/FlowerSettingsSurface', () => ({ FlowerSettingsSurface: (props: FlowerSettingsSurfaceProps) => { surface = props; return <div data-settings-panel />; } }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
function mount() {
  const host = document.createElement('div'); document.body.append(host);
  let directory!: (value: FlowerModelDirectory) => void;
  const snapshot = settingsSnapshot();
  const adapter = { loadSettings: vi.fn(async () => snapshot), canMutate: true, chatGPTAuth: vi.fn(async () => ({})), loadChatGPTAccounts: vi.fn(async () => []), discoverProviderModels: vi.fn(async () => ({})), saveDefaultPermission: vi.fn(async () => snapshot), subscribeModelDirectory: (listener: typeof directory) => { directory = listener; return vi.fn(); } } as unknown as FlowerSurfaceAdapter;
  const [canEdit, setCanEdit] = createSignal(true);
  dispose = render(() => <FlowerSettingsPanel adapter={adapter} canEdit={canEdit()} copy={DEFAULT_FLOWER_SURFACE_COPY} onOpenComputer={() => undefined} />, host);
  return { adapter, setCanEdit, directory: (value: FlowerModelDirectory) => directory(value) };
}
it('projects delayed directory publication without refreshing configuration in a loop', async () => {
  const fixture = mount(); await vi.waitFor(() => expect(document.querySelector('[data-settings-panel]')).not.toBeNull());
  fixture.directory({ current_model_id: '', models: [], sources: [] } as FlowerModelDirectory);
  await Promise.resolve(); await Promise.resolve();
  expect(fixture.adapter.loadSettings).toHaveBeenCalledTimes(1);
  expect(surface.snapshot?.model_directory?.models).toEqual([]);
});
it('gates every provider and account callback after authority is revoked', async () => {
  const fixture = mount(); await vi.waitFor(() => expect(document.querySelector('[data-settings-panel]')).not.toBeNull());
  fixture.setCanEdit(false);
  await expect(surface.chatGPTAuth!('start', { scope_id: 'test' })).rejects.toThrow('authority');
  await expect(surface.loadChatGPTAccounts!()).rejects.toThrow('authority');
  await expect(surface.onDiscoverModels!({} as never)).rejects.toThrow('authority');
  await expect(surface.onSaveDefaultPermission('readonly')).rejects.toThrow('authority');
  expect(fixture.adapter.chatGPTAuth).not.toHaveBeenCalled(); expect(fixture.adapter.saveDefaultPermission).not.toHaveBeenCalled();
});
it('rejects late account completions from disposed owners', async () => {
  const fixture = mount(); await vi.waitFor(() => expect(document.querySelector('[data-settings-panel]')).not.toBeNull());
  let finish!: (value: unknown) => void;
  vi.mocked(fixture.adapter.chatGPTAuth!).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }));
  const request = surface.chatGPTAuth!('start', { scope_id: 'test' });
  dispose?.(); dispose = undefined; finish({});
  await expect(request).rejects.toThrow();
});
it('confirms one successful save while an unrelated parent refresh is loading', async () => {
  const fixture = mount(); await vi.waitFor(() => expect(surface.snapshot).toBeTruthy());
  const [parentLoading, setParentLoading] = createSignal(false);
  let finish!: () => void;
  vi.mocked(fixture.adapter.saveDefaultPermission).mockImplementationOnce(async () => { setParentLoading(true); await new Promise<void>(resolve => { finish = resolve; }); return settingsSnapshot(); });
  const result = surface.onSaveDefaultPermission('readonly'); expect(parentLoading()).toBe(true);
  finish(); await expect(result).resolves.toBeTruthy(); expect(surface.saveError).toBe(''); expect(surface.savedAt).toBeTypeOf('number');
});
it('does not publish account success after disposal during its reload', async () => {
  const fixture = mount(); await vi.waitFor(() => expect(surface.snapshot).toBeTruthy());
  let finish!: (value: ReturnType<typeof settingsSnapshot>) => void;
  vi.mocked(fixture.adapter.loadSettings).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const action = surface.chatGPTAuth!('sign-out', { scope_id: 'test' });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function')); dispose?.(); dispose = undefined; finish(settingsSnapshot());
  await expect(action).rejects.toThrow();
});
