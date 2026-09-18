import { Show, createMemo, type JSX } from 'solid-js';
import { Dialog, Tabs, TabPanel } from '@floegence/floe-webapp-core/ui';
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

export function EnvironmentSettingsDialog(props: {
  open: boolean;
  environment: DesktopEnvironmentEntry | null;
  tab: EnvironmentSettingsTab;
  i18n: DesktopI18n;
  onClose: () => void;
  onTabChange: (tab: EnvironmentSettingsTab) => void;
  connection: JSX.Element;
  access: JSX.Element;
}) {
  const isOpen = createMemo(() => props.open);
  const presentation = createMemo<DesktopEnvironmentEntry | null>(previous => props.environment ?? previous, null);
  const hasConnection = () => presentation()?.registration_ref?.kind !== 'local_environment';
  const hasAccess = () => !!presentation() && environmentHasAccessSettings(presentation()!);
  const hasTabs = () => hasConnection() && hasAccess();
  return <Dialog open={isOpen()} onOpenChange={open => { if (!open) props.onClose(); }}
    title={props.i18n.t('settings.settingsWindowTitle')} description={presentation()?.label}
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
