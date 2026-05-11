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

function FilesWidget(props: WidgetProps) {
  return (
    <EnvDeckSingletonSurface widgetId={props.widgetId} widgetType="redeven.files" surfaceLabel="File Browser">
      <div class="h-full">
        <RemoteFileBrowser widgetId={props.widgetId} />
      </div>
    </EnvDeckSingletonSurface>
  );
}

function TerminalWidget(props: WidgetProps) {
  const env = useEnvContext();

  return (
    <EnvDeckSingletonSurface widgetId={props.widgetId} widgetType="redeven.terminal" surfaceLabel="Terminal">
      <TerminalPanel
        variant="deck"
        openSessionRequest={env.openTerminalInDirectoryRequest()}
        onOpenSessionRequestHandled={env.consumeOpenTerminalInDirectoryRequest}
      />
    </EnvDeckSingletonSurface>
  );
}

function MonitorWidget(props: WidgetProps) {
  return (
    <EnvDeckSingletonSurface widgetId={props.widgetId} widgetType="redeven.monitor" surfaceLabel="Monitoring">
      <RuntimeMonitorPanel variant="deck" />
    </EnvDeckSingletonSurface>
  );
}

function CodespacesWidget(props: WidgetProps) {
  return (
    <EnvDeckSingletonSurface widgetId={props.widgetId} widgetType="redeven.codespaces" surfaceLabel="Codespaces">
      <EnvCodespacesPage />
    </EnvDeckSingletonSurface>
  );
}

function PortsWidget(props: WidgetProps) {
  return (
    <EnvDeckSingletonSurface
      widgetId={props.widgetId}
      widgetType="redeven.ports"
      surfaceLabel="Web Services"
    >
      <EnvPortForwardsPage />
    </EnvDeckSingletonSurface>
  );
}

function FlowerWidget(props: WidgetProps) {
  const env = useEnvContext();
  const available = () => env.env.state !== 'ready' || hasRWXPermissions(env.env());

  return (
    <EnvDeckSingletonSurface
      widgetId={props.widgetId}
      widgetType="redeven.ai"
      surfaceLabel="Flower"
      available={available()}
      unavailableTitle="Flower needs read, write, and execute access"
      unavailableDescription="Grant RWX permission for this environment to use the embedded Flower workspace."
    >
      <EnvDeckConversationShell
        widgetId={props.widgetId}
        railLabel="Flower threads"
        rail={<AIChatSidebar />}
        workbench={<EnvAIPage />}
      />
    </EnvDeckSingletonSurface>
  );
}

function CodexWidget(props: WidgetProps) {
  const env = useEnvContext();
  const available = () => env.env.state !== 'ready' || hasRWXPermissions(env.env());

  return (
    <EnvDeckSingletonSurface
      widgetId={props.widgetId}
      widgetType="redeven.codex"
      surfaceLabel="Codex"
      available={available()}
      unavailableTitle="Codex needs read, write, and execute access"
      unavailableDescription="Grant RWX permission for this environment to use the embedded Codex workspace."
    >
      <EnvDeckConversationShell
        widgetId={props.widgetId}
        railLabel="Codex threads"
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
