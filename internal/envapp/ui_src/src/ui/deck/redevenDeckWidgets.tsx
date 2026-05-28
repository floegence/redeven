import type { WidgetDefinition, WidgetProps } from '@floegence/floe-webapp-core';
import { Activity, Code, Files, Globe, Terminal } from '@floegence/floe-webapp-core/icons';

import { CodexNavigationIcon } from '../icons/CodexIcon';
import { FlowerNavigationIcon } from '../icons/FlowerSoftAuraIcon';
import { useEnvContext } from '../pages/EnvContext';
import { EnvAIPage } from '../pages/EnvAIPage';
import { AIChatSidebar } from '../pages/AIChatSidebar';
import { EnvCodespacesPage } from '../pages/EnvCodespacesPage';
import { EnvPortForwardsPage } from '../pages/EnvPortForwardsPage';
import { hasRWXPermissions } from '../pages/aiPermissions';
import { CodexPage } from '../codex/CodexPage';
import { CodexSidebarShell } from '../codex/CodexSidebarShell';
import { RemoteFileBrowser } from '../widgets/RemoteFileBrowser';
import { RuntimeMonitorPanel } from '../widgets/RuntimeMonitorPanel';
import { TerminalPanel } from '../widgets/TerminalPanel';
import { EnvDeckConversationShell, EnvDeckSingletonSurface } from './EnvDeckSurfaceShell';
import { useI18n } from '../i18n';

function FilesWidget(props: WidgetProps) {
  const i18n = useI18n();
  return (
    <EnvDeckSingletonSurface widgetId={props.widgetId} widgetType="redeven.files" surfaceLabel={i18n.t('shell.nav.fileBrowser')}>
      <div class="h-full">
        <RemoteFileBrowser widgetId={props.widgetId} />
      </div>
    </EnvDeckSingletonSurface>
  );
}

function TerminalWidget(props: WidgetProps) {
  const env = useEnvContext();
  const i18n = useI18n();

  return (
    <EnvDeckSingletonSurface widgetId={props.widgetId} widgetType="redeven.terminal" surfaceLabel={i18n.t('shell.nav.terminal')}>
      <TerminalPanel
        variant="deck"
        openSessionRequest={env.openTerminalInDirectoryRequest()}
        onOpenSessionRequestHandled={env.consumeOpenTerminalInDirectoryRequest}
      />
    </EnvDeckSingletonSurface>
  );
}

function MonitorWidget(props: WidgetProps) {
  const i18n = useI18n();
  return (
    <EnvDeckSingletonSurface widgetId={props.widgetId} widgetType="redeven.monitor" surfaceLabel={i18n.t('shell.nav.monitoring')}>
      <RuntimeMonitorPanel variant="deck" />
    </EnvDeckSingletonSurface>
  );
}

function CodespacesWidget(props: WidgetProps) {
  const i18n = useI18n();
  return (
    <EnvDeckSingletonSurface widgetId={props.widgetId} widgetType="redeven.codespaces" surfaceLabel={i18n.t('shell.nav.codespaces')}>
      <EnvCodespacesPage />
    </EnvDeckSingletonSurface>
  );
}

function PortsWidget(props: WidgetProps) {
  const i18n = useI18n();
  return (
    <EnvDeckSingletonSurface
      widgetId={props.widgetId}
      widgetType="redeven.ports"
      surfaceLabel={i18n.t('shell.nav.webServices')}
    >
      <EnvPortForwardsPage />
    </EnvDeckSingletonSurface>
  );
}

function FlowerWidget(props: WidgetProps) {
  const env = useEnvContext();
  const i18n = useI18n();
  const available = () => env.env.state !== 'ready' || hasRWXPermissions(env.env());

  return (
    <EnvDeckSingletonSurface
      widgetId={props.widgetId}
      widgetType="redeven.ai"
      surfaceLabel="Flower"
      available={available()}
      unavailableTitle={i18n.t('workbench.notices.flowerRwxTitle')}
      unavailableDescription={i18n.t('workbench.notices.flowerRwxDescription')}
    >
      <EnvDeckConversationShell
        widgetId={props.widgetId}
        railLabel={i18n.t('workbench.notices.flowerThreads')}
        rail={<AIChatSidebar />}
        workbench={<EnvAIPage />}
      />
    </EnvDeckSingletonSurface>
  );
}

function CodexWidget(props: WidgetProps) {
  const env = useEnvContext();
  const i18n = useI18n();
  const available = () => env.env.state !== 'ready' || hasRWXPermissions(env.env());

  return (
    <EnvDeckSingletonSurface
      widgetId={props.widgetId}
      widgetType="redeven.codex"
      surfaceLabel="Codex"
      available={available()}
      unavailableTitle={i18n.t('workbench.notices.codexRwxTitle')}
      unavailableDescription={i18n.t('workbench.notices.codexRwxDescription')}
    >
      <EnvDeckConversationShell
        widgetId={props.widgetId}
        railLabel={i18n.t('workbench.notices.codexThreads')}
        rail={<CodexSidebarShell />}
        workbench={<CodexPage />}
      />
    </EnvDeckSingletonSurface>
  );
}

export const redevenDeckWidgets: WidgetDefinition[] = [
  {
    type: 'redeven.files',
    name: 'Files',
    icon: Files,
    category: 'custom',
    component: FilesWidget,
    minColSpan: 8,
    minRowSpan: 4,
    defaultColSpan: 12,
    defaultRowSpan: 10,
  },
  {
    type: 'redeven.terminal',
    name: 'Terminal',
    icon: Terminal,
    category: 'terminal',
    component: TerminalWidget,
    minColSpan: 8,
    minRowSpan: 4,
    defaultColSpan: 12,
    defaultRowSpan: 10,
  },
  {
    type: 'redeven.monitor',
    name: 'Monitoring',
    icon: Activity,
    category: 'custom',
    component: MonitorWidget,
    minColSpan: 12,
    minRowSpan: 6,
    defaultColSpan: 24,
    defaultRowSpan: 12,
  },
  {
    type: 'redeven.codespaces',
    name: 'Codespaces',
    icon: Code,
    category: 'custom',
    component: CodespacesWidget,
    minColSpan: 12,
    minRowSpan: 8,
    defaultColSpan: 16,
    defaultRowSpan: 12,
  },
  {
    type: 'redeven.ports',
    name: 'Web Services',
    icon: Globe,
    category: 'custom',
    component: PortsWidget,
    minColSpan: 12,
    minRowSpan: 8,
    defaultColSpan: 16,
    defaultRowSpan: 12,
  },
  {
    type: 'redeven.ai',
    name: 'Flower',
    icon: FlowerNavigationIcon,
    category: 'custom',
    component: FlowerWidget,
    minColSpan: 12,
    minRowSpan: 10,
    defaultColSpan: 24,
    defaultRowSpan: 14,
  },
  {
    type: 'redeven.codex',
    name: 'Codex',
    icon: CodexNavigationIcon,
    category: 'custom',
    component: CodexWidget,
    minColSpan: 12,
    minRowSpan: 10,
    defaultColSpan: 24,
    defaultRowSpan: 14,
  },
];
