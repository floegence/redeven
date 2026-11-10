import { For, Show, createMemo, createSignal, createEffect, onCleanup, type JSX } from 'solid-js';
import { Button, Input, Select, SettingsLayout, SettingsNavigation } from '@floegence/floe-webapp-core/ui';
import { ChevronLeft, ChevronRight, X } from '@floegence/floe-webapp-core/icons';
import { useResizeObserver } from '@floegence/floe-webapp-core';
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
  i18n: DesktopI18n; createFlowerAdapter: (signal: AbortSignal) => FlowerSurfaceAdapter; flowerScope: string; available: boolean;
  appearance: () => JSX.Element; connections: () => JSX.Element; changed: () => void;
}) {
  const [search, setSearch] = createSignal('');
  const [navigationOpen, setNavigationOpen] = createSignal(false);
  const [navigationHost, setNavigationHost] = createSignal<HTMLDivElement>();
  const navigationSize = useResizeObserver(() => props.session.present() && navigationHost()?.isConnected ? navigationHost() : undefined);
  // IMPORTANT: A retained mobile control loses popup authority when its
  // container hides at the desktop breakpoint, even while Settings stays open.
  const navigationVisible = () => (navigationSize()?.width ?? 0) > 0;
  const navigationPresented = createMemo(() => props.session.present() && navigationVisible() && navigationOpen());
  createEffect(() => { if (!props.session.present() || !navigationVisible()) setNavigationOpen(false); });
  const target = props.session.target;
  const copy = createMemo(() => createDesktopFlowerSurfaceCopy(props.i18n));
  const ids = ['appearance', 'connection', 'ai', 'extensions', 'browser'] as const;
  const items = () => [
    { id: 'appearance', label: props.i18n.t('settings.interfaceTitle') },
    { id: 'connection', label: props.i18n.t('settings.settingsWindowTitle') },
    { id: 'ai', label: copy().settings.title },
    { id: 'extensions', label: copy().extensions.t('title') },
    { id: 'browser', label: copy().computer.title },
  ];
  // IMPORTANT: These are Flower capabilities, not independent Desktop categories.
  // Keep grouping in Floe's published navigation contract, including search.
  const groups = () => [
    { id: 'desktop', label: '', items: items().slice(0, 2) },
    { id: 'flower', label: props.i18n.t('settings.flowerGroup'), items: items().slice(2) },
  ].map(group => ({ ...group, items: group.items.filter(item => item.label.toLocaleLowerCase().includes(search().toLocaleLowerCase()) || group.label.toLocaleLowerCase().includes(search().toLocaleLowerCase())) })).filter(group => group.items.length);
  const FlowerPanel = (kind: string) => <Show when={props.flowerScope} keyed fallback={<p role="alert">{props.i18n.t('environmentCenter.environmentRegistrationUnavailable')}</p>}>{(_scope) => {
    const lifetime = new AbortController(); onCleanup(() => lifetime.abort());
    const adapter = props.createFlowerAdapter(lifetime.signal);
    return kind === 'ai' ? <FlowerSettingsPanel active={props.session.present() && props.available && target()?.section === 'ai' && (!target()?.resource || !!providerFocus())} adapter={adapter} copy={copy()} canEdit={props.available} providerFocusRequest={providerFocus()} onChanged={props.changed} onOpenComputer={() => props.session.open({ section: 'browser' })} />
      : kind === 'extensions' ? <Show when={adapter.extensions}>{extensions => <FlowerExtensionsSurface embedded active={props.session.present() && target()?.section === 'extensions' && !target()?.resource && props.available} adapter={extensions()} i18n={copy().extensions} />}</Show>
      : <FlowerComputerConnections embedded open={props.session.present() && target()?.section === 'browser'} onOpenChange={open => { if (!open) props.session.close(); }} threadID="" adapter={adapter} copy={copy().computer} />;
  }}</Show>;
  const providerFocus = () => target()?.section === 'ai' ? settingsProviderFocus(target()?.resource, props.session.revision()) : undefined;
  const panels: Record<string, () => JSX.Element> = { appearance: props.appearance, connection: props.connections, ai: () => FlowerPanel('ai'), extensions: () => FlowerPanel('extensions'), browser: () => FlowerPanel('browser') };
  const select = (section: string) => { if (props.session.present()) props.session.open({ section: section as import('../../../internal/settings_ui/src/settingsSession').SettingsSection }); };
  // IMPORTANT: The dialog header owns category identity. Scope remains bound
  // by flowerScope and the adapter, never by a decorative environment strip.
  const label = () => items().find(item => item.id === target()?.section)?.label ?? props.i18n.t('settings.unifiedTitle');
  return <SettingsDialog open={target() !== null} present={props.session.present()} onClose={props.session.close} onPresenceChange={props.session.setPresent}
    title={props.i18n.t('settings.unifiedTitle')} closeLabel={props.i18n.t('common.close')} closeOnBackdropClick
    header={<div class="redeven-settings-dialog-heading">
      {/* IMPORTANT: Parent navigation stays in the modal header and never
          opens another environment or saves a retained connection draft. */}
      <Show when={target()?.resource}><Button variant="ghost" size="icon" class="shrink-0" data-settings-parent aria-label={props.i18n.t('common.back')} onClick={() => { const current = target(); if (props.session.present() && current?.resource) props.session.open({ section: current.section }); }}><ChevronLeft class="size-4" /></Button></Show>
      <div class="redeven-settings-dialog-breadcrumb"><span>{props.i18n.t('settings.unifiedTitle')}</span><ChevronRight aria-hidden="true" /><span>{label()}</span></div>
      <div ref={setNavigationHost} class="redeven-settings-dialog-mobile"><Select open={navigationPresented()} onOpenChange={open => setNavigationOpen(open && props.session.present() && navigationVisible())} value={target()?.section ?? 'appearance'} onChange={section => { if (navigationVisible()) select(section); }} options={items().map(item => ({ value: item.id, label: ['ai', 'extensions', 'browser'].includes(item.id) && item.id !== 'ai' ? `${props.i18n.t('settings.flowerGroup')} · ${item.label}` : item.label }))} ariaLabel={props.i18n.t('settings.unifiedTitle')} /></div>
      <Button variant="ghost" size="icon" class="redeven-settings-dialog-close" aria-label={props.i18n.t('common.close')} onClick={props.session.close}><X class="h-4 w-4" /></Button>
    </div>}>
    <div class="redeven-desktop-settings h-full min-h-0">
    <SettingsLayout class="h-full min-h-0 w-full" sidebar={<SettingsNavigation value={target()?.section ?? 'appearance'} onChange={select} label={props.i18n.t('settings.unifiedTitle')}
      search={<Input value={search()} onInput={event => setSearch(event.currentTarget.value)} aria-label={props.i18n.t('floeControls.searchPlaceholder')} placeholder={props.i18n.t('floeControls.searchPlaceholder')} />}
      groups={groups()} />}>
      <div class="relative h-full min-h-0">
      <For each={ids}>{id => {
        const [mounted, setMounted] = createSignal(false);
        const [genericVisited, setGenericVisited] = createSignal(false);
        const registered = () => [...props.panels].reverse().find(entry => target()?.section === id && entry.target.section === id && entry.target.resource === target()?.resource);
        const generic = () => !registered() && (!target()?.resource || id === 'ai' && !!providerFocus()) && (id === 'appearance' || id === 'connection' || props.available);
        createEffect(() => { if (target()?.section === id) { setMounted(true); if (generic()) setGenericVisited(true); } });
        return <Show when={mounted()}> <div class="redeven-settings-dialog-page absolute inset-0 overflow-auto" hidden={target()?.section !== id} inert={target()?.section !== id}>
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
