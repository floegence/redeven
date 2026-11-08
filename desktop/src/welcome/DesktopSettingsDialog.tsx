import { For, Show, createMemo, createSignal, createEffect, onCleanup, type JSX } from 'solid-js';
import { Input, Select, SettingsLayout, SettingsNavigation } from '@floegence/floe-webapp-core/ui';
import { SettingsDialog } from '../../../internal/settings_ui/src/SettingsDialog';
import { settingsProviderFocus, type createSettingsSession } from '../../../internal/settings_ui/src/settingsSession';
import type { SettingsPanelRegistration } from '../../../internal/settings_ui/src/SettingsPanelHost';
import { FlowerSettingsPanel } from '../../../internal/flower_ui/src/settings/FlowerSettingsPanel';
import { FlowerExtensionsSurface } from '../../../internal/flower_ui/src/extensions/FlowerExtensionsSurface';
import { FlowerComputerConnections } from '../../../internal/flower_ui/src/FlowerComputerConnections';
import type { FlowerSurfaceAdapter } from '../../../internal/flower_ui/src/contracts/flowerSurfaceContracts';
import type { DesktopI18n } from '../shared/i18n';
import { createDesktopFlowerSurfaceCopy } from './flower/desktopFlowerSurfaceCopy';

export function DesktopSettingsDialog(props: {
  session: ReturnType<typeof createSettingsSession>; panels: readonly SettingsPanelRegistration[];
  i18n: DesktopI18n; createFlowerAdapter: (signal: AbortSignal) => FlowerSurfaceAdapter; flowerScope: string; flowerLabel: string; available: boolean;
  appearance: () => JSX.Element; connections: () => JSX.Element; changed: () => void;
}) {
  const [search, setSearch] = createSignal('');
  const target = props.session.target;
  const copy = createMemo(() => createDesktopFlowerSurfaceCopy(props.i18n));
  const ids = ['appearance', 'connection', 'ai', 'extensions', 'browser'] as const;
  const items = () => [
    { id: 'appearance', label: props.i18n.t('settings.languageTitle') },
    { id: 'connection', label: props.i18n.t('settings.settingsWindowTitle') },
    { id: 'ai', label: copy().settings.title },
    { id: 'extensions', label: copy().extensions.t('title') },
    { id: 'browser', label: copy().computer.title },
  ];
  const FlowerPanel = (kind: string) => <Show when={props.flowerScope} keyed fallback={<p role="alert">{props.i18n.t('environmentCenter.environmentRegistrationUnavailable')}</p>}>{(_scope) => {
    const lifetime = new AbortController(); onCleanup(() => lifetime.abort());
    const adapter = props.createFlowerAdapter(lifetime.signal);
    return kind === 'ai' ? <FlowerSettingsPanel active={props.session.present() && props.available && target()?.section === 'ai' && (!target()?.resource || !!providerFocus())} adapter={adapter} copy={copy()} canEdit={props.available} providerFocusRequest={providerFocus()} onChanged={props.changed} onOpenComputer={() => props.session.open({ section: 'browser' })} />
      : kind === 'extensions' ? <Show when={adapter.extensions}>{extensions => <FlowerExtensionsSurface active={props.session.present() && target()?.section === 'extensions' && !target()?.resource && props.available} adapter={extensions()} i18n={copy().extensions} onBack={props.session.close} />}</Show>
      : <FlowerComputerConnections embedded open={props.session.present() && target()?.section === 'browser'} onOpenChange={open => { if (!open) props.session.close(); }} threadID="" adapter={adapter} copy={copy().computer} />;
  }}</Show>;
  const providerFocus = () => target()?.section === 'ai' ? settingsProviderFocus(target()?.resource, props.session.revision()) : undefined;
  const panels: Record<string, () => JSX.Element> = { appearance: props.appearance, connection: props.connections, ai: () => FlowerPanel('ai'), extensions: () => FlowerPanel('extensions'), browser: () => FlowerPanel('browser') };
  const select = (section: string) => props.session.open({ section: section as import('../../../internal/settings_ui/src/settingsSession').SettingsSection });
  return <SettingsDialog open={target() !== null} present={props.session.present()} onClose={props.session.close} onPresenceChange={props.session.setPresent}
    title={props.i18n.t('settings.unifiedTitle')} closeLabel={props.i18n.t('common.close')}>
    <div class="flex h-full min-h-0 flex-col"><div class="border-b px-4 py-2"><Show when={['ai', 'extensions', 'browser'].includes(target()?.section ?? '')}><p class="truncate text-xs text-muted-foreground">{props.flowerLabel}</p></Show><div class="sm:hidden"><Select value={target()?.section ?? 'appearance'} onChange={select} options={items().map(item => ({ value: item.id, label: item.label }))} ariaLabel={props.i18n.t('settings.unifiedTitle')} /></div></div>
    <SettingsLayout class="h-full min-h-0 w-full" sidebar={<SettingsNavigation value={target()?.section ?? 'appearance'} onChange={select} label={props.i18n.t('settings.unifiedTitle')}
      search={<Input value={search()} onInput={event => setSearch(event.currentTarget.value)} aria-label={props.i18n.t('environmentCenter.searchPlaceholder')} />}
      groups={[{ id: 'settings', label: '', items: items().filter(item => item.label.toLowerCase().includes(search().toLowerCase())) }]} />}>
      <div class="relative h-full min-h-0">
      <For each={ids}>{id => {
        const [mounted, setMounted] = createSignal(false);
        const [genericVisited, setGenericVisited] = createSignal(false);
        const registered = () => [...props.panels].reverse().find(entry => target()?.section === id && entry.target.section === id && entry.target.resource === target()?.resource);
        const generic = () => !registered() && (!target()?.resource || id === 'ai' && !!providerFocus()) && (id === 'appearance' || id === 'connection' || props.available);
        createEffect(() => { if (target()?.section === id) { setMounted(true); if (generic()) setGenericVisited(true); } });
        return <Show when={mounted()}> <div class="absolute inset-0 overflow-auto p-4" hidden={target()?.section !== id} inert={target()?.section !== id}>
            <Show when={genericVisited()}><div hidden={!generic()} inert={!generic()}>{panels[id]()}</div></Show>
            <Show when={!registered() && !generic()}><p role="alert">{props.i18n.t('environmentCenter.environmentRegistrationUnavailable')}</p></Show>
            <For each={props.panels.filter(entry => entry.target.section === id)}>{entry => <Show when={props.session.present() && registered() === entry}>{entry.render()}</Show>}</For>
          </div>
        </Show>;
      }}</For>
      </div>
    </SettingsLayout></div>
  </SettingsDialog>;
}
