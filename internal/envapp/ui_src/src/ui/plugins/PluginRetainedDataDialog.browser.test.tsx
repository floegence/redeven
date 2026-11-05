import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { PluginTransportError, type PluginDataBinding, type PluginRetainedRecoveryInspection, type PluginRetainedRecoveryResult } from '@floegence/redevplugin-ui';
import { PluginRetainedDataDialog, type PluginRetainedDataAPI } from './PluginRetainedDataDialog';
import type { PluginInventoryItem } from './pluginTypes';
import { I18nProvider, type RedevenLocale } from '../i18n';
import { loadEnvAppDictionary } from '../i18n/locales';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';

const source: PluginDataBinding = { plugin_instance_id: 'plugin_saved_123456789abc', generation_id: 'generation_saved', state: 'retained', revision: 4, shape_hash: 'a'.repeat(64), retained_at: '2026-10-25T10:30:00Z' };
const target: PluginDataBinding = { ...source, plugin_instance_id: 'plugin_current', generation_id: 'generation_current', state: 'active', revision: 2, retained_at: undefined };
const inspection: PluginRetainedRecoveryInspection = { plan: { source, target, target_management_revision: 7, target_active_fingerprint: 'b'.repeat(64), retained_at: '2026-10-30T10:30:00Z' }, plan_hash: 'c'.repeat(64) };
const result: PluginRetainedRecoveryResult = { active: { ...target, generation_id: source.generation_id, revision: 3 }, retained: { ...source, generation_id: target.generation_id, revision: 5 }, management_revision: 8 };
const item: PluginInventoryItem = { inventoryKey: 'instance:current', pluginID: 'com.example.mindmap', pluginInstanceID: target.plugin_instance_id, displayName: 'Mind Map', description: 'A visual workspace', iconFallback: 'generic', category: 'productivity', searchKeywords: [], publisher: 'Example', version: '1.0.0', managementRevision: 7, lifecycleState: 'disabled', sourceKind: 'community', pinned: false, canDisable: false };
const disposers: Array<() => void> = [];

function mount(options: { enabled?: boolean; canDisable?: boolean; disable?: () => Promise<unknown>; api?: Partial<PluginRetainedDataAPI>; refresh?: () => Promise<unknown>; locale?: boolean } = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const [open, setOpen] = createSignal(true);
  const [owner, setOwner] = createSignal<object>({});
  const [canRecover, setCanRecover] = createSignal(true);
  const [canDisable, setCanDisable] = createSignal(options.canDisable ?? true);
  const [currentItem, setItem] = createSignal({ ...item, canDisable: Boolean(options.enabled) });
  const api = {
    listRecoverableData: vi.fn(async () => ({ retained_data: [source] })),
    inspectRetainedRecovery: vi.fn(async () => inspection),
    commitRetainedRecovery: vi.fn(async () => result),
    getRetainedRecoveryStatus: vi.fn(async () => ({ state: 'applied' as const, result })),
    ...options.api,
  };
  const onDisable = vi.fn(options.disable ?? (async () => { setItem((value) => ({ ...value, canDisable: false, managementRevision: 8 })); }));
  const refresh = vi.fn(options.refresh ?? (async () => undefined));
  const trigger = document.createElement('button');
  trigger.textContent = 'Open saved data';
  host.appendChild(trigger);
  const content = document.createElement('div');
  host.appendChild(content);
  const dismissed = vi.fn(() => trigger.focus());
  const view = () => <PluginRetainedDataDialog open={open()} item={currentItem()} ownerScope={owner()} canRecover={canRecover()} canDisable={canDisable()} api={api} onDisable={onDisable} onRefresh={refresh} onOpenChange={setOpen} onDismissed={dismissed} />;
  disposers.push(render(() => options.locale ? <I18nProvider>{view()}</I18nProvider> : view(), content));
  return { api, open, setOpen, owner, setOwner, setItem, setCanRecover, setCanDisable, onDisable, refresh, trigger, dismissed };
}

function stage() { return document.querySelector('[data-plugin-data-recovery]')?.getAttribute('data-stage'); }
async function waitStage(value: string) { await vi.waitFor(() => expect(stage()).toBe(value)); }
async function click(name: string) { await page.getByRole('button', { name, exact: true }).click(); }
async function review() { await waitStage('choose'); await click('Continue'); await waitStage('review'); }

afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY);
});

describe('saved plugin data recovery', () => {
  it('keeps discovery read-only and cancels without disabling or committing', async () => {
    const mounted = mount({ enabled: true });
    await waitStage('choose');
    expect(mounted.onDisable).not.toHaveBeenCalled();
    expect(mounted.api.listRecoverableData).toHaveBeenCalledWith(target.plugin_instance_id, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await click('Cancel');
    expect(mounted.open()).toBe(false);
    expect(mounted.onDisable).not.toHaveBeenCalled();
    expect(mounted.api.commitRetainedRecovery).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(mounted.trigger));
  });

  it('does not disable an enabled plugin with no compatible saved data', async () => {
    const mounted = mount({ enabled: true, api: { listRecoverableData: vi.fn(async () => ({ retained_data: [] })) } });
    await waitStage('choose');
    expect(document.body.textContent).toContain('No compatible saved data');
    expect(mounted.onDisable).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Disable and continue');
  });

  it('explicitly disables before inspection and commits the exact reviewed plan once', async () => {
    let resolveCommit!: (value: PluginRetainedRecoveryResult) => void;
    const commit = vi.fn(() => new Promise<PluginRetainedRecoveryResult>((resolve) => { resolveCommit = resolve; }));
    const mounted = mount({ enabled: true, api: { commitRetainedRecovery: commit } });
    await waitStage('choose');
    await click('Disable and continue');
    await waitStage('review');
    expect(mounted.onDisable).toHaveBeenCalledTimes(1);
    expect(mounted.api.inspectRetainedRecovery).toHaveBeenCalledWith({ source_plugin_instance_id: source.plugin_instance_id, target_plugin_instance_id: target.plugin_instance_id }, expect.anything());
    const button = document.querySelector<HTMLButtonElement>('[data-plugin-recovery-confirm]')!;
    button.click(); button.click();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(inspection, expect.anything());
    resolveCommit(result);
    await waitStage('complete');
    expect(mounted.refresh).toHaveBeenCalledTimes(1);
  });

  it.each(['unknown', 'committed'] as const)('reconciles a %s response without replaying commit', async (outcome) => {
    const commit = vi.fn(async () => { throw new PluginTransportError('Response lost', undefined, outcome); });
    const status = vi.fn(async () => ({ state: 'applied' as const, result }));
    mount({ api: { commitRetainedRecovery: commit, getRetainedRecoveryStatus: status } });
    await review(); await click('Restore'); await waitStage('complete');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(inspection, expect.anything());
  });

  it('retains an unknown plan across close and reopen and only checks its status', async () => {
    const commit = vi.fn(async () => { throw new PluginTransportError('Response lost', undefined, 'unknown'); });
    const status = vi.fn(async () => { throw new Error('Offline'); });
    const mounted = mount({ api: { commitRetainedRecovery: commit, getRetainedRecoveryStatus: status } });
    await review(); await click('Restore'); await waitStage('unresolved');
    expect(document.body.textContent).not.toContain('Review again');
    await click('Cancel'); mounted.setOpen(true);
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2));
    await waitStage('unresolved');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(mounted.api.listRecoverableData).toHaveBeenCalledTimes(1);
  });

  it('requires a new review after a confirmed pending result and never retries automatically', async () => {
    const commit = vi.fn(async () => { throw new PluginTransportError('Response lost', undefined, 'unknown'); });
    const mounted = mount({ api: { commitRetainedRecovery: commit, getRetainedRecoveryStatus: vi.fn(async () => ({ state: 'pending' as const })) } });
    await review(); await click('Restore'); await waitStage('not_applied');
    expect(commit).toHaveBeenCalledTimes(1);
    await click('Review again'); await waitStage('choose');
    expect(mounted.api.inspectRetainedRecovery).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('keeps a successful restore complete when inventory refresh fails', async () => {
    const mounted = mount({ refresh: async () => { throw new Error('Offline'); } });
    await review(); await click('Restore'); await waitStage('complete');
    await vi.waitFor(() => expect(document.body.textContent).toContain('Refresh the plugin list'));
    await click('Refresh');
    expect(stage()).toBe('complete');
    expect(mounted.api.commitRetainedRecovery).toHaveBeenCalledTimes(1);
  });

  it('aborts old discovery when owner changes and ignores its late response', async () => {
    let resolveOld!: (value: { retained_data: PluginDataBinding[] }) => void;
    let oldSignal: AbortSignal | undefined;
    const list = vi.fn<PluginRetainedDataAPI['listRecoverableData']>()
      .mockImplementationOnce(async (_id, options) => { oldSignal = options?.signal; return new Promise((resolve) => { resolveOld = resolve; }); })
      .mockResolvedValueOnce({ retained_data: [] });
    const mounted = mount({ api: { listRecoverableData: list } });
    await waitStage('loading');
    mounted.setOwner({}); await waitStage('choose');
    resolveOld({ retained_data: [source] });
    await Promise.resolve();
    expect(oldSignal?.aborted).toBe(true);
    expect(document.body.textContent).toContain('No compatible saved data');
    expect(document.querySelector('input[type=radio]')).toBeNull();
  });

  it('requires a fresh inspection after a confirmed rejected commit', async () => {
    const commit = vi.fn(async () => { throw new PluginTransportError('Rejected', undefined, 'not_committed'); });
    const mounted = mount({ api: { commitRetainedRecovery: commit } });
    await review(); await click('Restore'); await waitStage('choose');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(mounted.api.getRetainedRecoveryStatus).not.toHaveBeenCalled();
    await click('Continue'); await waitStage('review');
    expect(mounted.api.inspectRetainedRecovery).toHaveBeenCalledTimes(2);
  });

  it('only refreshes inventory after an uncertain disable and never replays it', async () => {
    const mounted = mount({ enabled: true, disable: async () => { throw new PluginTransportError('Response lost', undefined, 'unknown'); } });
    await waitStage('choose'); await click('Disable and continue'); await waitStage('disable_unknown');
    await click('Check status');
    expect(mounted.onDisable).toHaveBeenCalledTimes(1);
    expect(mounted.api.inspectRetainedRecovery).not.toHaveBeenCalled();
    expect(stage()).toBe('disable_unknown');
    mounted.setItem({ ...item, canDisable: false });
    await click('Check status'); await waitStage('choose');
    await click('Continue'); await waitStage('review');
    expect(mounted.onDisable).toHaveBeenCalledTimes(1);
  });

  it('keeps selection actionable when inspection fails', async () => {
    const inspect = vi.fn(async () => { throw new Error('Stale data'); });
    const mounted = mount({ api: { inspectRetainedRecovery: inspect } });
    await waitStage('choose'); await click('Continue'); await waitStage('choose');
    expect(document.querySelector<HTMLInputElement>('input[type=radio]')?.checked).toBe(true);
    expect(mounted.api.commitRetainedRecovery).not.toHaveBeenCalled();
  });

  it('does not offer disabling to a data writer without management permission', async () => {
    const mounted = mount({ enabled: true, canDisable: false });
    await waitStage('choose');
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === 'Disable and continue');
    expect(button?.disabled).toBe(true);
    expect(mounted.onDisable).not.toHaveBeenCalled();
  });

  it('drops an old reviewed plan when the target instance changes', async () => {
    const mounted = mount(); await review();
    mounted.setItem({ ...item, pluginInstanceID: 'plugin_second', inventoryKey: 'instance:second', canDisable: false });
    await waitStage('choose');
    expect(mounted.api.listRecoverableData).toHaveBeenLastCalledWith('plugin_second', expect.anything());
    expect(document.querySelector('[data-plugin-recovery-confirm]')).toBeNull();
    expect(mounted.api.commitRetainedRecovery).not.toHaveBeenCalled();
  });

  it('closes when recovery permission is revoked', async () => {
    const mounted = mount(); await review(); mounted.setCanRecover(false);
    await vi.waitFor(() => expect(mounted.open()).toBe(false));
    expect(mounted.api.commitRetainedRecovery).not.toHaveBeenCalled();
  });

  it('preserves the exact review through an ordinary inventory refresh', async () => {
    const mounted = mount(); await review();
    mounted.setItem({ ...item, canDisable: false, description: 'Refreshed inventory' });
    await Promise.resolve();
    expect(stage()).toBe('review');
    expect(mounted.api.listRecoverableData).toHaveBeenCalledTimes(1);
    await click('Restore'); await waitStage('complete');
    expect(mounted.api.commitRetainedRecovery).toHaveBeenCalledExactlyOnceWith(inspection, expect.anything());
  });

  it('reconciles a force-closed in-flight commit without replay on reopening', async () => {
    let resolveCommit!: (value: PluginRetainedRecoveryResult) => void;
    const commit = vi.fn(() => new Promise<PluginRetainedRecoveryResult>((resolve) => { resolveCommit = resolve; }));
    const mounted = mount({ api: { commitRetainedRecovery: commit } });
    await review(); await click('Restore'); await waitStage('committing');
    mounted.setOpen(false);
    resolveCommit(result); await Promise.resolve();
    mounted.setOpen(true); await waitStage('complete');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(mounted.api.getRetainedRecoveryStatus).toHaveBeenCalledExactlyOnceWith(inspection, expect.anything());
  });

  it('uses native radio keyboard selection and returns focus after Escape', async () => {
    const other = { ...source, plugin_instance_id: 'plugin_saved_other', generation_id: 'generation_other' };
    const mounted = mount({ api: { listRecoverableData: vi.fn(async () => ({ retained_data: [source, other] })) } });
    await waitStage('choose');
    const radios = document.querySelectorAll<HTMLInputElement>('input[type=radio]');
    radios[0]!.focus(); await userEvent.keyboard('{ArrowDown}');
    expect(radios[1]!.checked).toBe(true);
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(document.activeElement).toBe(mounted.trigger));
  });

  for (const theme of ['light', 'dark']) for (const width of [390, 1180]) {
    it(`fits ${width}px ${theme} with a concise review and usable touch targets`, async () => {
      await page.viewport(width, 844);
      document.documentElement.classList.add(theme);
      mount(); await review();
      const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
      const rect = dialog.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.right).toBeLessThanOrEqual(width + 1);
      expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
      if (width === 390) for (const button of dialog.querySelectorAll('button')) {
        const size = button.getBoundingClientRect();
        if (size.width > 0) { expect(size.width).toBeGreaterThanOrEqual(44); expect(size.height).toBeGreaterThanOrEqual(44); }
      }
      expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1000);
    });
  }

  it.each(['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU'] as RedevenLocale[])('renders an explicit %s catalog without missing keys', async (locale) => {
    localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale);
    await loadEnvAppDictionary(locale); mount({ locale: true });
    await waitStage('choose');
    expect(document.body.textContent).not.toContain('uiCopy.');
  });
});
