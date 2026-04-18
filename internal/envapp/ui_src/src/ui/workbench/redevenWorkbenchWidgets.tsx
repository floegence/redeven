import type {
  WorkbenchWidgetBodyProps,
  WorkbenchWidgetDefinition,
} from '@floegence/floe-webapp-core/workbench';
import { Activity, Code, Files, Globe, Terminal } from '@floegence/floe-webapp-core/icons';
import { Show, type JSX } from 'solid-js';

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
import { EnvWorkbenchConversationShell } from './EnvWorkbenchConversationShell';

function WorkbenchBodyNotice(props: {
  title: string;
  description: string;
  eyebrow?: string;
  action?: JSX.Element;
}) {
  return (
    <div class="flex h-full min-h-0 items-center justify-center bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--primary)_8%,transparent),_transparent_52%)] p-4">
      <div class="w-full max-w-md rounded-2xl border border-border/70 bg-background/92 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur">
        <Show when={props.eyebrow}>
          <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">{props.eyebrow}</div>
        </Show>
        <div class="mt-2 text-base font-semibold text-foreground">{props.title}</div>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">{props.description}</p>
        <Show when={props.action}>
          <div class="mt-4 flex items-center gap-2">{props.action}</div>
        </Show>
      </div>
    </div>
  );
}

function FilesWidget() {
  return (
    <div class="h-full min-h-0 bg-background">
      <RemoteFileBrowser />
    </div>
  );
}

function TerminalWidget() {
  const env = useEnvContext();
  return (
    <TerminalPanel
      variant="workbench"
      openSessionRequest={env.openTerminalInDirectoryRequest()}
      onOpenSessionRequestHandled={env.consumeOpenTerminalInDirectoryRequest}
    />
  );
}

function MonitorWidget() {
  return <RuntimeMonitorPanel variant="workbench" />;
}

function CodespacesWidget() {
  return (
    <div class="h-full min-h-0 overflow-auto bg-background">
      <EnvCodespacesPage />
    </div>
  );
}

function PortsWidget() {
  const env = useEnvContext();
  const available = () => env.localRuntime() === null;

  return (
    <Show
      when={available()}
      fallback={(
        <WorkbenchBodyNotice
          eyebrow="Ports"
          title="Port forwards are remote-only"
          description="This environment is connected directly to a local runtime, so port forwarding is not exposed as a separate workbench surface."
        />
      )}
    >
      <div class="h-full min-h-0 overflow-auto bg-background">
        <EnvPortForwardsPage />
      </div>
    </Show>
  );
}

function FlowerWidget(_props: WorkbenchWidgetBodyProps) {
  const env = useEnvContext();
  const available = () => env.env.state !== 'ready' || hasRWXPermissions(env.env());

  return (
    <Show
      when={available()}
      fallback={(
        <WorkbenchBodyNotice
          eyebrow="Flower"
          title="Flower needs read, write, and execute access"
          description="Grant RWX permission for this environment to use the embedded Flower workspace in workbench mode."
        />
      )}
    >
      <EnvWorkbenchConversationShell
        railLabel="Flower threads"
        rail={<AIChatSidebar />}
        workbench={<EnvAIPage />}
      />
    </Show>
  );
}

function CodexWidget(_props: WorkbenchWidgetBodyProps) {
  const env = useEnvContext();
  const available = () => env.env.state !== 'ready' || hasRWXPermissions(env.env());

  return (
    <Show
      when={available()}
      fallback={(
        <WorkbenchBodyNotice
          eyebrow="Codex"
          title="Codex needs read, write, and execute access"
          description="Grant RWX permission for this environment to use the embedded Codex workspace in workbench mode."
        />
      )}
    >
      <EnvWorkbenchConversationShell
        railLabel="Codex threads"
        rail={<CodexSidebarShell />}
        workbench={<CodexPage />}
      />
    </Show>
  );
}

export const redevenWorkbenchWidgets: readonly WorkbenchWidgetDefinition[] = [
  {
    type: 'redeven.files',
    label: 'Files',
    icon: Files,
    body: FilesWidget,
    defaultTitle: 'Files',
    defaultSize: { width: 760, height: 560 },
    group: 'workspace',
    singleton: true,
  },
  {
    type: 'redeven.terminal',
    label: 'Terminal',
    icon: Terminal,
    body: TerminalWidget,
    defaultTitle: 'Terminal',
    defaultSize: { width: 840, height: 500 },
    group: 'runtime',
    singleton: true,
  },
  {
    type: 'redeven.monitor',
    label: 'Monitoring',
    icon: Activity,
    body: MonitorWidget,
    defaultTitle: 'Monitoring',
    defaultSize: { width: 760, height: 420 },
    group: 'observability',
    singleton: true,
  },
  {
    type: 'redeven.codespaces',
    label: 'Codespaces',
    icon: Code,
    body: CodespacesWidget,
    defaultTitle: 'Codespaces',
    defaultSize: { width: 780, height: 520 },
    group: 'workspace',
    singleton: true,
  },
  {
    type: 'redeven.ports',
    label: 'Ports',
    icon: Globe,
    body: PortsWidget,
    defaultTitle: 'Ports',
    defaultSize: { width: 760, height: 480 },
    group: 'network',
    singleton: true,
  },
  {
    type: 'redeven.ai',
    label: 'Flower',
    icon: FlowerNavigationIcon,
    body: FlowerWidget,
    defaultTitle: 'Flower',
    defaultSize: { width: 980, height: 620 },
    group: 'assistant',
    singleton: true,
  },
  {
    type: 'redeven.codex',
    label: 'Codex',
    icon: CodexNavigationIcon,
    body: CodexWidget,
    defaultTitle: 'Codex',
    defaultSize: { width: 980, height: 620 },
    group: 'assistant',
    singleton: true,
  },
];
