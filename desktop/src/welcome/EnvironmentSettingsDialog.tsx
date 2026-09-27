import { Show, createMemo, type JSX } from 'solid-js';
import { Dialog, Tabs, TabPanel, createFloatingPresence } from '@floegence/floe-webapp-core/ui';
import type { DesktopI18n } from '../shared/i18n';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import { environmentHasAccessSettings, type EnvironmentSettingsTab } from './environmentSettingsSession';

/** Product panel layout: only the body scrolls, including when its tab is retained. */
export function EnvironmentSettingsPanel(props: { children: JSX.Element; footer?: JSX.Element; onKeyDown?: JSX.EventHandler<HTMLDivElement, KeyboardEvent> }) {
  return <div class="environment-settings-panel" onKeyDown={props.onKeyDown}>
    <div class="environment-settings-scroll">{props.children}</div>
    <Show when={props.footer}><div class="environment-settings-actions">{props.footer}</div></Show>
  </div>;
}

/** Floe retains exiting settings content; product CSS only animates its layout. */
export function EnvironmentSettingsReveal(props: { open: boolean; children: JSX.Element }) {
  const presence = createFloatingPresence({ open: () => props.open, exitDurationMs: 180 });
  return <Show when={presence.mounted()}>
    <div data-settings-reveal data-state={presence.state()} inert={!props.open} aria-hidden={!props.open || undefined}>
      <div class="environment-settings-reveal-content">{props.children}</div>
    </div>
  </Show>;
}

export function EnvironmentSettingsDialog(props: {
  open: boolean;
  environment: DesktopEnvironmentEntry | null;
  tab: EnvironmentSettingsTab;
  i18n: DesktopI18n;
  onClose: () => void;
  onTabChange: (tab: EnvironmentSettingsTab) => void;
  onPresenceChange?: (present: boolean) => void;
  connection: JSX.Element;
  access: JSX.Element;
}) {
  const isOpen = createMemo(() => props.open);
  const presentation = createMemo<DesktopEnvironmentEntry | null>(previous => props.environment ?? previous, null);
  const hasConnection = () => presentation()?.registration_ref?.kind !== 'local_environment';
  const hasAccess = () => !!presentation() && environmentHasAccessSettings(presentation()!);
  const hasTabs = () => hasConnection() && hasAccess();
  const dialogTitle = createMemo(() => {
    const title = props.i18n.t('settings.settingsWindowTitle');
    const label = presentation()?.label?.trim();
    return label ? `${title} · ${label}` : title;
  });
  return <Dialog open={isOpen()} onOpenChange={open => { if (!open) props.onClose(); }}
    onPresenceChange={props.onPresenceChange}
    title={dialogTitle()}
    closeLabel={props.i18n.t('common.close')} escapeKeyPhase="bubble"
    class={`redeven-environment-settings-dialog${hasTabs() ? ' environment-settings-with-tabs' : ''}`} contentClass="environment-settings-content">
    <Show when={hasTabs()}>
      <Tabs items={[
        { id: 'connection', label: props.i18n.t('settings.connectionTab') },
        { id: 'access', label: props.i18n.t('settings.accessTab') },
      ]} activeId={props.tab} onChange={id => props.onTabChange(id as EnvironmentSettingsTab)}
        features={{ indicator: { mode: 'slider', animated: true, thicknessPx: 2 } }}
        slotClassNames={{ tab: 'environment-settings-tab-trigger', indicator: 'environment-settings-indicator' }}
        ariaLabel={props.i18n.t('settings.settingsWindowTitle')} class="environment-settings-tabs" />
    </Show>
    <TabPanel active={hasConnection() && props.tab === 'connection'} keepMounted class="environment-settings-tab">
      {props.connection}
    </TabPanel>
    <TabPanel active={hasAccess() && props.tab === 'access'} keepMounted class="environment-settings-tab">
      {props.access}
    </TabPanel>
  </Dialog>;
}
