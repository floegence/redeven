import { Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { type FloeComponent, useCommand, useLayout, useNotification, useTheme, useWidgetRegistry } from '@floegence/floe-webapp-core';
import { ActivityAppsMain, FloeRegistryRuntime } from '@floegence/floe-webapp-core/app';
import {
  Activity,
  Code,
  Copy,
  Files,
  Globe,
  Grid3x3,
  LayoutDashboard,
  Moon,
  Refresh,
  Search,
  Settings,
  Sun,
  Terminal,
} from '@floegence/floe-webapp-core/icons';
import { FlowerIcon } from './icons/FlowerIcon';
import { BottomBarItem, Panel, PanelContent, Shell, StatusIndicator, type ActivityBarItem } from '@floegence/floe-webapp-core/layout';
import { Tooltip } from '@floegence/floe-webapp-core/ui';
import type { ClientObserverLike } from '@floegence/flowersec-core';
import { useProtocol } from '@floegence/floe-webapp-protocol';

import { EnvContext, type AskFlowerComposerAnchor, type EnvNavTab, type EnvSettingsSection } from './pages/EnvContext';
import type { AskFlowerIntent } from './pages/askFlowerIntent';
import { EnvDeckPage } from './pages/EnvDeckPage';
import { EnvTerminalPage } from './pages/EnvTerminalPage';
import { EnvMonitorPage } from './pages/EnvMonitorPage';
import { EnvFileBrowserPage } from './pages/EnvFileBrowserPage';
import { EnvCodespacesPage } from './pages/EnvCodespacesPage';
import { EnvPortForwardsPage } from './pages/EnvPortForwardsPage';
import { EnvAIPage } from './pages/EnvAIPage';
import { AIChatContext, createAIChatContextValue, type ModelsResponse } from './pages/AIChatContext';
import { AIChatSidebar } from './pages/AIChatSidebar';
import { EnvSettingsPage } from './pages/EnvSettingsPage';
import { hasRWXPermissions } from './pages/aiPermissions';
import { redevenDeckWidgets } from './deck/redevenDeckWidgets';
import { useRedevenRpc } from './protocol/redeven_v1';
import { AuditLogDialog } from './widgets/AuditLogDialog';
import { AskFlowerComposerWindow } from './widgets/AskFlowerComposerWindow';
import { buildAskFlowerDraftMarkdown } from './utils/askFlowerContextTemplate';
import { resolveSuggestedWorkingDirAbsolute } from './utils/askFlowerPath';
import { fetchGatewayJSON, gatewayRequestCredentials } from './services/gatewayApi';
import { getSandboxWindowInfo } from './services/sandboxWindowRegistry';
import { consumeAccessResumeTokenFromWindow } from './accessResume';
import {
  channelInitEntry,
  getEnvPublicIDFromSession,
  getLocalAccessStatus,
  getLocalRuntime,
  getEnvironment,
  mintEnvProxyEntryTicket,
  mintLocalDirectConnectInfo,
  mintEnvEntryTicketForApp,
  unlockLocalAccess,
  type EnvironmentDetail,
  type LocalAccessStatus,
  type LocalRuntimeInfo,
} from './services/controlplaneApi';

const FLOE_APP_AGENT = 'com.floegence.redeven.agent';
const CODE_SPACE_ID_ENV_UI = 'env-ui';

const ACTIVE_TAB_STORAGE_KEY = 'redeven_envapp_active_tab';
const ACTIVE_THREAD_STORAGE_KEY = 'redeven_ai_active_thread_id';
const EXECUTION_MODE_STORAGE_KEY = 'redeven_ai_execution_mode';

type CreateThreadResponse = Readonly<{
  thread: Readonly<{
    thread_id: string;
  }>;
}>;

function readPersistedExecutionMode(): 'act' | 'plan' {
  try {
    const value = String(localStorage.getItem(EXECUTION_MODE_STORAGE_KEY) ?? '').trim().toLowerCase();
    return value === 'plan' ? 'plan' : 'act';
  } catch {
    return 'act';
  }
}

function persistActiveThreadId(threadId: string): void {
  try {
    const value = String(threadId ?? '').trim();
    if (!value) return;
    localStorage.setItem(ACTIVE_THREAD_STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

function readPersistedActiveTab(): EnvNavTab | null {
  try {
    const v = String(localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) ?? '').trim();
    // Backward compat: the "market" tab was removed; redirect old preferences.
    if (v === 'market') return 'codespaces';
    if (
      v === 'deck' ||
      v === 'terminal' ||
      v === 'monitor' ||
      v === 'files' ||
      v === 'codespaces' ||
      v === 'ports' ||
      v === 'ai'
    ) {
      return v;
    }
    return null;
  } catch {
    return null;
  }
}

function persistActiveTab(tab: EnvNavTab): void {
  try {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    // ignore
  }
}

// Bridge: provides AIChatContext to Shell and its children (requires EnvContext above).
function AIChatProviderBridge(props: { children: any }) {
  const ctx = createAIChatContextValue();
  return <AIChatContext.Provider value={ctx}>{props.children}</AIChatContext.Provider>;
}

export function EnvAppShell() {
  const layout = useLayout();
  const theme = useTheme();
  const widgetRegistry = useWidgetRegistry();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const cmd = useCommand();
  const notify = useNotification();

  type ProtocolConnectConfig = Parameters<typeof protocol.connect>[0];

  widgetRegistry.registerAll(redevenDeckWidgets);

  const [localRuntime, setLocalRuntime] = createSignal<LocalRuntimeInfo | null>(null);
  const isLocalMode = createMemo(() => localRuntime() !== null);
  const [localAccessStatus, setLocalAccessStatus] = createSignal<LocalAccessStatus | null>(null);
  const [localAccessChecked, setLocalAccessChecked] = createSignal(false);
  const [localAccessPassword, setLocalAccessPassword] = createSignal('');
  const [localAccessError, setLocalAccessError] = createSignal<string | null>(null);
  const [localAccessUnlocking, setLocalAccessUnlocking] = createSignal(false);
  const [localAccessChannelReady, setLocalAccessChannelReady] = createSignal(false);
  const [localAccessResumeToken, setLocalAccessResumeToken] = createSignal(
    typeof window !== 'undefined' ? consumeAccessResumeTokenFromWindow(window) : '',
  );
  let localAccessPasswordInput: HTMLInputElement | undefined;

  const localPasswordRequired = createMemo(() => Boolean(localAccessStatus()?.password_required));
  const localAccessPending = createMemo(() => isLocalMode() && !localAccessChecked());
  const localAccessLocked = createMemo(() => isLocalMode() && localPasswordRequired() && !String(localAccessResumeToken() ?? '').trim());
  const localAccessResumePending = createMemo(
    () => isLocalMode() && localPasswordRequired() && !localAccessPending() && !localAccessLocked() && !localAccessChannelReady(),
  );
  const localAccessGateVisible = createMemo(() => localAccessPending() || localAccessLocked() || localAccessResumePending());

  const [envId, setEnvId] = createSignal(getEnvPublicIDFromSession());

  const [env] = createResource<EnvironmentDetail | null, string | null>(
    () => {
      const id = envId() || null;
      if (!id) return null;
      if (localAccessGateVisible()) return null;
      return id;
    },
    (id) => (id ? getEnvironment(id) : null),
  );

  const [manualError, setManualError] = createSignal<string | null>(null);
  const [auditOpen, setAuditOpen] = createSignal(false);
  const canViewAudit = createMemo(() => Boolean(env()?.permissions?.can_admin));
  const canUseFlower = createMemo(() => env.state === 'ready' && hasRWXPermissions(env()));

  const [pendingAutoOpenAI, setPendingAutoOpenAI] = createSignal(false);
  let initialTab: EnvNavTab | null = null;

  const [askFlowerIntentSeq, setAskFlowerIntentSeq] = createSignal(0);
  const [askFlowerIntent, setAskFlowerIntent] = createSignal<AskFlowerIntent | null>(null);
  const [askFlowerComposerOpen, setAskFlowerComposerOpen] = createSignal(false);
  const [askFlowerComposerIntent, setAskFlowerComposerIntent] = createSignal<AskFlowerIntent | null>(null);
  const [askFlowerComposerAnchor, setAskFlowerComposerAnchor] = createSignal<AskFlowerComposerAnchor | null>(null);

  const [settingsSeq, setSettingsSeq] = createSignal(0);
  const bumpSettingsSeq = () => setSettingsSeq((n) => n + 1);

  const [settingsFocusSeq, setSettingsFocusSeq] = createSignal(0);
  const [settingsFocusSection, setSettingsFocusSection] = createSignal<EnvSettingsSection | null>(null);
  const [aiThreadFocusSeq, setAIThreadFocusSeq] = createSignal(0);
  const [aiThreadFocusId, setAIThreadFocusId] = createSignal<string | null>(null);

  const openSettings = (section?: EnvSettingsSection) => {
    if (!section) {
      setSettingsFocusSection(null);
    }
    if (section) {
      setSettingsFocusSection(section);
      setSettingsFocusSeq((n) => n + 1);
    }
    layout.setSidebarActiveTab('settings', { openSidebar: false });
  };

  const injectAskFlowerIntent = (intent: AskFlowerIntent) => {
    setAskFlowerIntent(intent);
    setAskFlowerIntentSeq((n) => n + 1);
  };

  const focusAIThread = (threadId: string) => {
    const tid = String(threadId ?? '').trim();
    if (!tid) return;
    setAIThreadFocusId(tid);
    setAIThreadFocusSeq((n) => n + 1);
  };

  const openAskFlowerComposer = (intent: AskFlowerIntent, anchor?: AskFlowerComposerAnchor) => {
    if (!canUseFlower()) {
      notify.error('Permission denied', 'Read/write/execute permission required.');
      return;
    }
    setAskFlowerComposerIntent(intent);
    setAskFlowerComposerAnchor(anchor ?? null);
    setAskFlowerComposerOpen(true);
  };

  const closeAskFlowerComposer = () => {
    setAskFlowerComposerOpen(false);
    setAskFlowerComposerIntent(null);
    setAskFlowerComposerAnchor(null);
  };

  const uploadAskFlowerAttachment = async (file: File): Promise<string> => {
    const form = new FormData();
    form.append('file', file);

    const resp = await fetch('/_redeven_proxy/api/ai/uploads', {
      method: 'POST',
      body: form,
      credentials: gatewayRequestCredentials(),
      cache: 'no-store',
    });

    const text = await resp.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }
    if (!resp.ok) throw new Error(String(data?.error ?? `HTTP ${resp.status}`));
    if (data?.ok === false) throw new Error(String(data?.error ?? 'Upload failed'));

    const url = String(data?.data?.url ?? '').trim();
    if (!url) throw new Error('Upload failed');
    return url;
  };

  const resolveAskFlowerModel = async (): Promise<string> => {
    const models = await fetchGatewayJSON<ModelsResponse>('/_redeven_proxy/api/ai/models', { method: 'GET' });
    const options = Array.isArray(models?.models) ? models.models : [];
    const allowed = new Set<string>();
    for (const item of options) {
      const id = String(item?.id ?? '').trim();
      if (id) allowed.add(id);
    }

    const currentModel = String(models?.current_model ?? '').trim();
    if (currentModel && allowed.has(currentModel)) return currentModel;

    const first = String(options[0]?.id ?? '').trim();
    if (first && allowed.has(first)) return first;

    throw new Error('No available model. Configure AI in Settings first.');
  };

  const validateAskFlowerWorkingDir = async (workingDir: string): Promise<string> => {
    const normalizedWorkingDir = String(workingDir ?? '').trim();
    if (!normalizedWorkingDir) return '';

    const resp = await fetchGatewayJSON<Readonly<{ working_dir: string }>>('/_redeven_proxy/api/ai/validate_working_dir', {
      method: 'POST',
      body: JSON.stringify({ working_dir: normalizedWorkingDir }),
    });
    const cleaned = String(resp?.working_dir ?? '').trim();
    if (!cleaned) {
      throw new Error('Invalid working directory.');
    }
    return cleaned;
  };

  const createAskFlowerThread = async (params: { modelId: string; workingDir: string; executionMode: 'act' | 'plan' }): Promise<string> => {
    const body: Record<string, unknown> = { title: '' };
    if (params.modelId) body.model_id = params.modelId;
    body.execution_mode = params.executionMode;
    if (params.workingDir) body.working_dir = params.workingDir;

    const resp = await fetchGatewayJSON<CreateThreadResponse>('/_redeven_proxy/api/ai/threads', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const threadId = String(resp?.thread?.thread_id ?? '').trim();
    if (!threadId) {
      throw new Error('Failed to create chat thread.');
    }
    return threadId;
  };

  const submitAskFlowerComposer = async (userPrompt: string): Promise<void> => {
    const intent = askFlowerComposerIntent();
    if (!intent) return;

    if (protocol.status() !== 'connected') {
      notify.error('Not connected', 'Connecting to agent...');
      return;
    }
    if (!canUseFlower()) {
      notify.error('Permission denied', 'Read/write/execute permission required.');
      return;
    }

    const trimmedPrompt = String(userPrompt ?? '').trim();
    if (!trimmedPrompt) {
      notify.error('Missing message', 'Please enter your question before sending.');
      return;
    }

    try {
      const modelId = await resolveAskFlowerModel();
      const executionMode = readPersistedExecutionMode();
      const suggestedWorkingDir = resolveSuggestedWorkingDirAbsolute({
        suggestedWorkingDirAbs: intent.suggestedWorkingDirAbs,
        suggestedWorkingDirVirtual: intent.suggestedWorkingDirVirtual,
        fsRootAbs: intent.fsRootAbs,
      });
      const validatedWorkingDir = await validateAskFlowerWorkingDir(suggestedWorkingDir);
      const threadId = await createAskFlowerThread({ modelId, workingDir: validatedWorkingDir, executionMode });

      const uploadedAttachments: Array<{ name: string; mimeType: string; url: string }> = [];
      for (const file of intent.pendingAttachments) {
        const url = await uploadAskFlowerAttachment(file);
        uploadedAttachments.push({
          name: String(file.name ?? '').trim() || 'attachment',
          mimeType: String(file.type ?? '').trim() || 'application/octet-stream',
          url,
        });
      }

      try {
        await rpc.ai.subscribeThread({ threadId });
      } catch {
        // Best-effort: send still persists and AI page can self-heal via transcript loading.
      }

      const finalPrompt =
        buildAskFlowerDraftMarkdown({
          intent: {
            ...intent,
            userPrompt: trimmedPrompt,
          },
          includeSuggestedWorkingDir: false,
        }) || trimmedPrompt;

      await rpc.ai.sendUserTurn({
        threadId,
        model: modelId,
        input: {
          text: finalPrompt,
          attachments: uploadedAttachments,
        },
        options: {
          maxSteps: 10,
          mode: executionMode,
        },
      });

      persistActiveThreadId(threadId);
      focusAIThread(threadId);
      closeAskFlowerComposer();
      goTab('ai');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify.error('Failed to send to Flower', msg || 'Request failed.');
    }
  };

  const status = createMemo(() => {
    if (localAccessLocked()) return 'disconnected';
    if (manualError()) return 'error';
    return protocol.status();
  });
  const statusLabel = createMemo(() => {
    if (localAccessPending()) return 'Checking access';
    if (localAccessLocked()) return 'Locked';
    return undefined;
  });
  const connecting = () => !localAccessGateVisible() && protocol.status() === 'connecting';
  const reconnectDisabled = createMemo(() => localAccessGateVisible() || connecting());
  const reconnectLabel = createMemo(() => {
    if (localAccessPending()) return 'Checking access';
    if (localAccessLocked()) return 'Unlock required';
    return connecting() ? 'Connecting...' : 'Reconnect';
  });
  const connectError = createMemo(() => (localAccessGateVisible() ? null : manualError() ?? protocol.error()?.message ?? null));

  const RECENT_AGENT_RX_MS = 10_000;
  const PROBE_TIMEOUT_MS = 1_200;

  let lastAgentRxAtMs = 0;
  const markAgentRx = () => {
    lastAgentRxAtMs = Date.now();
  };

  const observer: ClientObserverLike = {
    onRpcNotify: () => {
      markAgentRx();
    },
    onRpcCall: (result) => {
      // Only count results that prove we received a response envelope from the peer.
      if (result === 'ok' || result === 'rpc_error' || result === 'handler_not_found') {
        markAgentRx();
      }
    },
  };

  let ensureInFlight: Promise<void> | null = null;
  let accessResumeClient: unknown = null;
  let accessResumeInFlight: Promise<void> | null = null;

  const ensureAccessResumed = async () => {
    const client = protocol.client();
    if (!client || protocol.status() !== 'connected') return;
    if (accessResumeClient === client) return;
    if (accessResumeInFlight) return accessResumeInFlight;

    accessResumeInFlight = (async () => {
      const status = await rpc.access.status();
      if (!status.passwordRequired || status.unlocked) {
        accessResumeClient = client;
        setLocalAccessChannelReady(true);
        setLocalAccessError(null);
        setManualError(null);
        return;
      }

      const token = String(localAccessResumeToken() ?? '').trim();
      if (!token) {
        setLocalAccessChannelReady(false);
        setLocalAccessError('Enter the access password to continue.');
        throw new Error('Access password required. Refresh and unlock again.');
      }

      try {
        await rpc.access.resume({ token });
      } catch (error) {
        setLocalAccessChannelReady(false);
        if (isLocalMode()) {
          setLocalAccessResumeToken('');
          setLocalAccessError('Access password expired. Enter it again to continue.');
        }
        throw error;
      }
      accessResumeClient = client;
      setLocalAccessChannelReady(true);
      setLocalAccessError(null);
      setManualError(null);
    })();

    try {
      await accessResumeInFlight;
    } finally {
      accessResumeInFlight = null;
    }
  };

  const createGetGrant = () => async () => {
    const id = envId();
    if (!id) throw new Error('Missing env context. Please reopen from the Redeven Portal.');

    // Probe agent status to avoid grant-audit spam while the agent is clearly offline.
    let agentStatus: string | null = null;
    try {
      const detail = await getEnvironment(id);
      // `status` is the only availability source of truth returned by the controlplane API.
      agentStatus = detail?.status ? String(detail.status) : null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Redirecting to Redeven Portal')) throw new Error(msg);
      // For transient failures (meta/network), continue with the grant flow below.
    }
    if (agentStatus && agentStatus !== 'online') {
      throw new Error(`Agent is ${agentStatus}.`);
    }

    const entryTicket = await mintEnvProxyEntryTicket({
      endpointId: id,
      floeApp: FLOE_APP_AGENT,
      codeSpaceId: CODE_SPACE_ID_ENV_UI,
    });

    return channelInitEntry({ endpointId: id, floeApp: FLOE_APP_AGENT, entryTicket });
  };

  const runConnect = async (fn: (config: ProtocolConnectConfig) => Promise<void>) => {
    if (connecting() || localAccessPending() || localAccessLocked()) return;

    const id = envId();
    if (!id) {
      setManualError('Missing env context. Please reopen from the Redeven Portal.');
      protocol.disconnect();
      return;
    }

    setManualError(null);

    try {
      if (isLocalMode()) {
        setLocalAccessChannelReady(false);
        const directInfo = await mintLocalDirectConnectInfo();
        await fn({
          mode: 'direct',
          directInfo,
          observer,
          // Direct mode requires a fresh connect_info (channel_id/psk) per attempt.
          // Disable protocol-level autoReconnect (it reuses directInfo) and let the shell re-mint.
          autoReconnect: { enabled: false },
        });
      } else {
        await fn({
          mode: 'tunnel',
          getGrant: createGetGrant(),
          observer,
          autoReconnect: {
            enabled: true,
            // Env App should be resilient to agent restarts and transient network issues.
            maxAttempts: 1_000_000,
            initialDelayMs: 500,
            maxDelayMs: 30_000,
          },
        });
      }
      await ensureAccessResumed();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isLocalMode() && message.toLowerCase().includes('access password')) {
        setLocalAccessResumeToken('');
        setLocalAccessError('Enter the access password to continue.');
      }
      if (message) setManualError(message);
      protocol.disconnect();
    }
  };

  const connect = async () => runConnect((config) => protocol.connect(config));
  const reconnect = async () => runConnect((config) => protocol.reconnect(config));

  const submitLocalAccessUnlock = async (event?: SubmitEvent) => {
    event?.preventDefault();
    if (localAccessUnlocking()) return;

    setLocalAccessUnlocking(true);
    setLocalAccessError(null);
    setManualError(null);

    try {
      const out = await unlockLocalAccess(localAccessPassword());
      const token = String(out?.resume_token ?? '').trim();
      if (!token) {
        throw new Error('Unlock succeeded but no resume token was returned.');
      }

      setLocalAccessResumeToken(token);
      setLocalAccessPassword('');
      accessResumeClient = null;

      const nextStatus = await getLocalAccessStatus();
      setLocalAccessStatus(nextStatus ?? { password_required: true, unlocked: true });
      setLocalAccessChecked(true);

      await connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalAccessError(message || 'Unlock failed.');
      queueMicrotask(() => {
        localAccessPasswordInput?.focus();
        localAccessPasswordInput?.select();
      });
    } finally {
      setLocalAccessUnlocking(false);
    }
  };

  createEffect(() => {
    if (!localAccessLocked()) return;
    if (localAccessPending()) return;
    queueMicrotask(() => localAccessPasswordInput?.focus());
  });

  createEffect(() => {
    if (!isLocalMode() || !localPasswordRequired()) return;
    if (protocol.status() !== 'connected') {
      setLocalAccessChannelReady(false);
    }
  });

  createEffect(() => {
    if (localAccessGateVisible()) {
      accessResumeClient = null;
      return;
    }

    const client = protocol.client();
    const st = protocol.status();
    if (st !== 'connected' || !client) {
      accessResumeClient = null;
      return;
    }
    if (accessResumeClient === client) return;
    void ensureAccessResumed().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (message) setManualError(message);
      protocol.disconnect();
    });
  });

  const probe = async (): Promise<boolean> => {
    const startedAt = Date.now();

    const p = rpc.sys.ping();
    // If we timeout and then close the client (by reconnecting), the original ping promise
    // might reject later; attach a handler to avoid unhandled rejections.
    p.catch(() => {
    });

    let timer: number | undefined;
    try {
      await Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS);
        }),
      ]);
      console.debug('[envapp] health probe ok', { ms: Date.now() - startedAt });
      return true;
    } catch (e) {
      console.debug('[envapp] health probe failed', {
        ms: Date.now() - startedAt,
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    } finally {
      if (typeof timer !== 'undefined') window.clearTimeout(timer);
    }
  };

  const ensureHealthy = (reason: string) => {
    if (ensureInFlight) return ensureInFlight;

    ensureInFlight = (async () => {
      if (localAccessGateVisible()) return;
      if (connecting()) return;

      const st = protocol.status();
      const client = protocol.client();
      if (st !== 'connected' || !client) {
        console.debug('[envapp] ensureHealthy: connect', { reason, status: st });
        await connect();
        return;
      }

      const now = Date.now();
      const lastRxAgeMs = lastAgentRxAtMs > 0 ? now - lastAgentRxAtMs : Number.POSITIVE_INFINITY;
      if (lastRxAgeMs <= RECENT_AGENT_RX_MS) {
        console.debug('[envapp] ensureHealthy: recent rx; skip', { reason, lastRxAgeMs });
        return;
      }

      console.debug('[envapp] ensureHealthy: probing', { reason, lastRxAgeMs });
      const ok = await probe();
      if (ok) return;

      const rxAgeAfterProbe = lastAgentRxAtMs > 0 ? Date.now() - lastAgentRxAtMs : Number.POSITIVE_INFINITY;
      if (rxAgeAfterProbe <= RECENT_AGENT_RX_MS) {
        console.debug('[envapp] ensureHealthy: rx during probe; skip reconnect', { reason, rxAgeAfterProbe });
        return;
      }

      console.debug('[envapp] ensureHealthy: reconnect', { reason });
      await reconnect();
    })().finally(() => {
      ensureInFlight = null;
    });

    return ensureInFlight;
  };

  // Local UI mode reconnect: directInfo cannot be reused across reconnects (agent restarts, consumed channel_id).
  // Keep a small backoff loop that re-mints connect_info via the local HTTP API.
  let localReconnectTimer: number | null = null;
  let localReconnectBackoffMs = 500;

  const scheduleLocalReconnect = (reason: string) => {
    if (!isLocalMode() || localAccessGateVisible()) return;
    if (localReconnectTimer !== null) return;

    const delay = Math.min(localReconnectBackoffMs, 30_000);
    const jitter = Math.floor(Math.random() * Math.min(200, Math.max(1, Math.floor(delay / 5))));
    localReconnectTimer = window.setTimeout(() => {
      localReconnectTimer = null;
      if (!isLocalMode()) return;
      if (protocol.status() === 'connected' || protocol.status() === 'connecting') return;

      void (async () => {
        // If we never successfully connected, protocol.reconnect() might reject; fall back to connect().
        if (!protocol.client()) {
          await connect();
        } else {
          await reconnect();
        }
      })().finally(() => {
        localReconnectBackoffMs = Math.min(localReconnectBackoffMs * 2, 30_000);
        if (isLocalMode() && protocol.status() !== 'connected' && protocol.status() !== 'connecting') {
          scheduleLocalReconnect('retry');
        }
      });
    }, delay + jitter);

    console.debug('[envapp] local reconnect scheduled', { reason, delayMs: delay + jitter });
  };

  createEffect(() => {
    if (!isLocalMode()) return;

    if (localAccessGateVisible()) {
      if (localReconnectTimer !== null) {
        window.clearTimeout(localReconnectTimer);
        localReconnectTimer = null;
      }
      return;
    }

    const st = protocol.status();
    if (st === 'connected') {
      localReconnectBackoffMs = 500;
      if (localReconnectTimer !== null) {
        window.clearTimeout(localReconnectTimer);
        localReconnectTimer = null;
      }
      return;
    }
    if (st === 'error' || st === 'disconnected') {
      scheduleLocalReconnect(st);
    }
  });

  onCleanup(() => {
    if (localReconnectTimer !== null) window.clearTimeout(localReconnectTimer);
    localReconnectTimer = null;
  });

  onMount(() => {
    layout.setSidebarCollapsed(true);
    void (async () => {
      const rt = await getLocalRuntime();
      let localStatus: LocalAccessStatus | null = null;
      if (rt) {
        setLocalRuntime(rt);
        localStatus = await getLocalAccessStatus();
        setLocalAccessStatus(localStatus);
        setLocalAccessChecked(true);
        setLocalAccessChannelReady(!Boolean(localStatus?.password_required));

        const localEnvID = String((rt as any).env_public_id ?? '').trim() || 'env_local';
        try {
          sessionStorage.setItem('redeven_env_public_id', localEnvID);
        } catch {
          // ignore
        }
        setEnvId(localEnvID);
      } else {
        setLocalRuntime(null);
        setLocalAccessStatus(null);
        setLocalAccessChecked(true);
        setLocalAccessChannelReady(true);
        setEnvId(getEnvPublicIDFromSession());
      }

      let preferred = readPersistedActiveTab();
      if (rt && preferred === 'ports') preferred = 'codespaces';
      if (preferred === 'ai') {
        // Defer opening Flower until permissions are loaded (and only if RWX is granted).
        preferred = null;
        setPendingAutoOpenAI(true);
      }

      const initial = (() => {
        if (preferred) {
          if (layout.isMobile() && preferred === 'deck') return 'terminal';
          return preferred;
        }
        return layout.isMobile() ? 'terminal' : 'deck';
      })();
      // Mobile downgrade: keep "deck" as the persisted preference while opening "terminal".
      if (layout.isMobile() && preferred === 'deck' && initial === 'terminal') skipPersistOnce = true;
      layout.setSidebarActiveTab(initial, { openSidebar: false });
      initialTab = initial;
      setPersistReady(true);

      if (rt && localStatus?.password_required && !String(localAccessResumeToken() ?? '').trim()) {
        setManualError(null);
        return;
      }

      await connect();
    })();
  });

  onCleanup(() => {
    protocol.disconnect();
  });

  // Cross-window handshake: allow non-Env App sandbox windows (codespaces/3rd-party apps) to
  // request a fresh entry_ticket after refresh.
  onMount(() => {
    const onMessage = (ev: MessageEvent) => {
      if (isLocalMode()) return;

      const data: any = ev.data;
      if (!data || typeof data !== 'object') return;
      if (String(data.type ?? '') !== 'redeven:boot_ready') return;

      const payload: any = data.payload;
      const floeApp = String(payload?.floe_app ?? '').trim();
      const codeSpaceID = String(payload?.code_space_id ?? '').trim();
      if (!floeApp || !codeSpaceID) return;

      const info = getSandboxWindowInfo(ev.source);
      if (!info) return;
      if (ev.origin !== info.origin) return;
      if (floeApp !== info.floe_app || codeSpaceID !== info.code_space_id) return;

      const envPublicID = envId();
      if (!envPublicID) return;

      void (async () => {
        try {
          const entryTicket = await mintEnvEntryTicketForApp({ envId: envPublicID, floeApp, codeSpaceId: codeSpaceID });
          (ev.source as Window).postMessage(
            {
              type: 'redeven:boot_init',
              payload: {
                v: 2,
                env_public_id: envPublicID,
                floe_app: floeApp,
                code_space_id: codeSpaceID,
                app_path: info.app_path,
                entry_ticket: entryTicket,
              },
            },
            info.origin,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          notify.error('Failed to refresh session', msg);
        }
      })();
    };

    window.addEventListener('message', onMessage);
    onCleanup(() => window.removeEventListener('message', onMessage));
  });

  // Ensure the tunnel is healthy after common browser lifecycle transitions.
  onMount(() => {
    const onOnline = () => void ensureHealthy('online');
    const onFocus = () => void ensureHealthy('focus');
    const onVisibility = () => {
      if (!document.hidden) void ensureHealthy('visibility');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    onCleanup(() => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    });
  });

  const components = createMemo<FloeComponent[]>(() => {
    const list: FloeComponent[] = [
      { id: 'deck', name: 'Deck', icon: LayoutDashboard, component: EnvDeckPage, sidebar: { order: 1, fullScreen: true } },
      { id: 'terminal', name: 'Terminal', icon: Terminal, component: EnvTerminalPage, sidebar: { order: 2, fullScreen: true } },
      { id: 'monitor', name: 'Monitoring', icon: Activity, component: EnvMonitorPage, sidebar: { order: 3, fullScreen: true } },
      { id: 'files', name: 'File Browser', icon: Files, component: EnvFileBrowserPage, sidebar: { order: 4, fullScreen: true } },
      { id: 'codespaces', name: 'Codespaces', icon: Code, component: EnvCodespacesPage, sidebar: { order: 5, fullScreen: true } },
    ];
    // Local UI mode disables port forwarding entirely.
    if (!isLocalMode()) {
      list.push({ id: 'ports', name: 'Ports', icon: Globe, component: EnvPortForwardsPage, sidebar: { order: 6, fullScreen: true } });
    }
    // Always register the AI view to keep ActivityAppsMain/KeepAliveStack stable:
    // permissions load asynchronously, but FloeRegistryRuntime registers components only once on mount.
    // Access to Flower is still gated via navigation + permission checks.
    list.push({ id: 'ai', name: 'Flower', icon: FlowerIcon, component: EnvAIPage, sidebar: { order: 7, fullScreen: false, renderIn: 'main' } });
    list.push({ id: 'settings', name: 'Settings', icon: Settings, component: EnvSettingsPage, sidebar: { order: 99, fullScreen: true } });
    return list;
  });

  const [persistReady, setPersistReady] = createSignal(false);
  let skipPersistOnce = false;

  const goTab = (tab: EnvNavTab) => {
    if (tab === 'ai' && !canUseFlower()) {
      notify.error('Permission denied', 'Read/write/execute permission required.');
      return;
    }
    // Persist the user's preference; the runtime may downgrade it on mobile (deck -> terminal).
    persistActiveTab(tab);
    let next = tab;
    if (layout.isMobile() && next === 'deck') next = 'terminal';
    // Prevent the downgraded "terminal" tab from overriding the user's persisted preference ("deck").
    if (layout.isMobile() && tab === 'deck' && next === 'terminal') skipPersistOnce = true;
    layout.setSidebarActiveTab(next, { openSidebar: next === 'ai' });
  };

  // If the user preferred Flower and the session has RWX, open it once after permissions load.
  createEffect(() => {
    if (!persistReady() || !pendingAutoOpenAI()) return;
    if (env.state === 'ready' && !canUseFlower()) {
      setPendingAutoOpenAI(false);
      return;
    }
    if (!canUseFlower()) return;
    if (initialTab && layout.sidebarActiveTab() !== initialTab) return;
    setPendingAutoOpenAI(false);
    goTab('ai');
  });

  // Never keep the user on Flower when RWX is not granted.
  createEffect(() => {
    if (layout.sidebarActiveTab() !== 'ai') return;
    if (canUseFlower()) return;
    const fallback = layout.isMobile() ? 'terminal' : 'deck';
    layout.setSidebarActiveTab(fallback, { openSidebar: false });
  });

  // Keep a global (cross-env) active tab preference, independent from FloeProvider's per-env storage namespace.
  // NOTE: On mobile, the "deck" tab is downgraded to "terminal"; skip persisting that one downgrade.
  createEffect(() => {
    if (!persistReady()) return;
    const id = layout.sidebarActiveTab();
    const allowPorts = !isLocalMode();
    const isKnown =
      id === 'deck' ||
      id === 'terminal' ||
      id === 'monitor' ||
      id === 'files' ||
      id === 'codespaces' ||
      (id === 'ai' && canUseFlower()) ||
      (allowPorts && id === 'ports');
    if (!isKnown) return;
    if (skipPersistOnce) {
      skipPersistOnce = false;
      return;
    }
    persistActiveTab(id as EnvNavTab);
  });

  const activityItems = (): ActivityBarItem[] => {
    const items: ActivityBarItem[] = [];

    if (!layout.isMobile()) {
      items.push({ id: 'deck', icon: LayoutDashboard, label: 'Deck', collapseBehavior: 'preserve' });
    }
    items.push(
      { id: 'terminal', icon: Terminal, label: 'Terminal', collapseBehavior: 'preserve' },
      { id: 'monitor', icon: Activity, label: 'Monitoring', collapseBehavior: 'preserve' },
      { id: 'files', icon: Files, label: 'File Browser', collapseBehavior: 'preserve' },
      { id: 'codespaces', icon: Code, label: 'Codespaces', collapseBehavior: 'preserve' },
    );
    if (!isLocalMode()) {
      items.push({ id: 'ports', icon: Globe, label: 'Ports', collapseBehavior: 'preserve' });
    }
    if (canUseFlower()) {
      items.push({ id: 'ai', icon: FlowerIcon, label: 'Flower', collapseBehavior: 'toggle' });
    }
    return items;
  };

  const activityBottomItems = (): ActivityBarItem[] => {
    return [{ id: 'settings', icon: Settings, label: 'Settings', onClick: () => openSettings() }];
  };

  const envName = () => {
    if (isLocalMode() && localAccessGateVisible()) return 'Local agent';
    if (env.state !== 'ready') return 'Loading...';
    return env()?.name || 'Environment';
  };

  function consoleOrigin(): string {
    // Env App runs on a sandbox subdomain (env-<id>.<region>.<base>).
    // Console is served on the base domain (<base>).
    const proto = window.location.protocol;
    const host = window.location.hostname.trim().toLowerCase();
    const port = window.location.port ? `:${window.location.port}` : '';
    const parts = host.split('.');

    // sandbox_id.<region>.<base>
    if (parts.length >= 4 && (parts[0].startsWith('env-') || parts[0].startsWith('cs-'))) {
      parts.shift();
      parts.shift();
      return `${proto}//${parts.join('.')}${port}`;
    }

    // <region>.<base>
    if (parts.length >= 3) {
      parts.shift();
      return `${proto}//${parts.join('.')}${port}`;
    }

    return `${proto}//${host}${port}`;
  }

  // Env App command palette commands (navigation + common actions).
  // Note: register commands once per Shell lifecycle to avoid duplicates during HMR/remount.
  createEffect(() => {
    const local = isLocalMode();

    const list: any[] = [
      {
        id: 'redeven.env.goToDeck',
        title: 'Go to Deck',
        description: 'Open the deck view',
        category: 'Navigation',
        keybind: 'mod+shift+d',
        icon: LayoutDashboard,
        execute: () => goTab('deck'),
      },
      {
        id: 'redeven.env.goToTerminal',
        title: 'Go to Terminal',
        description: 'Open the terminal',
        category: 'Navigation',
        keybind: 'mod+shift+t',
        icon: Terminal,
        execute: () => goTab('terminal'),
      },
      {
        id: 'redeven.env.goToMonitoring',
        title: 'Go to Monitoring',
        description: 'Open monitoring',
        category: 'Navigation',
        keybind: 'mod+shift+m',
        icon: Activity,
        execute: () => goTab('monitor'),
      },
      {
        id: 'redeven.env.goToFiles',
        title: 'Go to File Browser',
        description: 'Browse remote files',
        category: 'Navigation',
        keybind: 'mod+shift+f',
        icon: Files,
        execute: () => goTab('files'),
      },
      {
        id: 'redeven.env.goToCodespaces',
        title: 'Go to Codespaces',
        description: 'Open codespaces',
        category: 'Navigation',
        keybind: 'mod+shift+c',
        icon: Code,
        execute: () => goTab('codespaces'),
      },
    ];

    // Local UI mode disables port forwarding entirely.
    if (!local) {
      list.push({
        id: 'redeven.env.goToPorts',
        title: 'Go to Ports',
        description: 'Open port forwards',
        category: 'Navigation',
        keybind: 'mod+shift+o',
        icon: Globe,
        execute: () => goTab('ports'),
      });
    }

    list.push(
      {
        id: 'redeven.env.backToDashboard',
        title: 'Back to Dashboard',
        description: 'Return to the console dashboard',
        category: 'Navigation',
        keybind: 'mod+shift+e',
        icon: Grid3x3,
        execute: () => window.location.assign(`${consoleOrigin()}/dashboard`),
      },
      {
        id: 'redeven.env.reconnect',
        title: 'Reconnect',
        description: 'Reconnect to the environment tunnel',
        category: 'Environment',
        keybind: 'mod+shift+r',
        icon: Refresh,
        execute: () => {
          void reconnect();
        },
      },
      {
        id: 'redeven.env.copyEnvId',
        title: 'Copy Environment ID',
        description: 'Copy the environment id to clipboard',
        category: 'Environment',
        icon: Copy,
        execute: async () => {
          const id = envId() || '';
          if (!id) {
            notify.error('Copy failed', 'Missing environment id');
            return;
          }

          try {
            await navigator.clipboard.writeText(id);
            notify.success('Copied', 'Environment id copied to clipboard');
          } catch {
            notify.error('Copy failed', 'Clipboard permission denied');
          }
        },
      },
      {
        id: 'redeven.env.toggleTheme',
        title: 'Toggle Theme',
        description: 'Switch between light and dark theme',
        category: 'View',
        keybind: 'mod+shift+l',
        icon: () => (theme.resolvedTheme() === 'light' ? <Moon class="w-4 h-4" /> : <Sun class="w-4 h-4" />),
        execute: () => {
          theme.toggleTheme();
          const nextTheme = theme.resolvedTheme() === 'light' ? 'dark' : 'light';
          notify.info('Theme changed', `Switched to ${nextTheme} theme`);
        },
      },
      {
        id: 'redeven.env.openCommandPalette',
        title: 'Open Command Palette',
        description: 'Open the command palette',
        category: 'General',
        keybind: 'mod+k',
        icon: Search,
        execute: () => cmd.open(),
      },
    );

    const unregister = cmd.registerAll(list as any);
    onCleanup(() => unregister());
  });

  const localAccessGatePanel = () => (
    <div class="flex h-full min-h-0 items-center justify-center bg-background px-4 py-6">
      <Panel class="w-full max-w-md border-border shadow-sm">
        <PanelContent class="flex flex-col gap-4 p-6">
          <div class="space-y-2">
            <div class="text-lg font-semibold text-foreground">{localAccessResumePending() ? 'Preparing secure session' : 'Unlock local agent'}</div>
            <p class="text-sm leading-6 text-muted-foreground">
              {localAccessResumePending()
                ? 'Verifying the password for this browser load and connecting to the local agent.'
                : 'Enter the full access password before this browser load can connect to the local agent.'}
            </p>
          </div>

          <Show when={!localAccessResumePending()}>
            <form class="flex flex-col gap-3" onSubmit={(event) => void submitLocalAccessUnlock(event)}>
              <input
                ref={localAccessPasswordInput}
                type="password"
                autocomplete="current-password"
                placeholder="Access password"
                value={localAccessPassword()}
                onInput={(event) => setLocalAccessPassword(event.currentTarget.value)}
                disabled={localAccessPending() || localAccessUnlocking()}
                class="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-[border,box-shadow] placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={localAccessPending() || localAccessUnlocking() || !localAccessPassword()}
                class="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {localAccessUnlocking() ? 'Unlocking...' : 'Unlock'}
              </button>
            </form>
          </Show>

          <Show when={localAccessPending()}>
            <div class="text-sm text-muted-foreground">Checking local access...</div>
          </Show>

          <Show when={localAccessResumePending()}>
            <div class="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              The page stays blocked until the direct agent session confirms the password for this browser load.
            </div>
          </Show>

          <Show when={localAccessError()}>
            <div class="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">{localAccessError()}</div>
          </Show>

          <div class="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
            Password verification stays inside the agent before any page connection is allowed.
          </div>
        </PanelContent>
      </Panel>
    </div>
  );

  return (
    <EnvContext.Provider
      value={{
        env_id: envId,
        env,
        connect,
        connecting,
        connectError,
        goTab,
        settingsSeq,
        bumpSettingsSeq,
        openSettings,
        settingsFocusSeq,
        settingsFocusSection,
        askFlowerIntentSeq,
        askFlowerIntent,
        injectAskFlowerIntent,
        openAskFlowerComposer,
        aiThreadFocusSeq,
        aiThreadFocusId,
        focusAIThread,
      }}
    >
      <FloeRegistryRuntime components={components()}>
        <AIChatProviderBridge>
        <Shell
          sidebarMode="auto"
          sidebarContent={(activeTab) => activeTab === 'ai' && canUseFlower() ? <AIChatSidebar /> : <></>}
          logo={
            <Tooltip content="Back to dashboard" placement="bottom" delay={0}>
              <button
                type="button"
                class="flex items-center justify-center w-8 h-8 rounded cursor-pointer hover:bg-muted/60 transition-colors"
                onClick={() => window.location.assign(`${consoleOrigin()}/dashboard`)}
                aria-label="Back to dashboard"
              >
                <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Redeven" class="w-6 h-6 object-contain" />
              </button>
            </Tooltip>
          }
          activityItems={activityItems()}
          activityBottomItems={activityBottomItems()}
          activityBottomItemsMobileMode="topBar"
          topBarActions={
            <div class="flex items-center gap-1">
              <Tooltip content="Command palette" placement="bottom" delay={0}>
                <button
                  type="button"
                  class="flex items-center justify-center w-8 h-8 rounded cursor-pointer hover:bg-muted/60 transition-colors"
                  onClick={() => cmd.open()}
                  aria-label="Command palette"
                >
                  <Search class="w-4 h-4" />
                </button>
              </Tooltip>
              <Tooltip content="Toggle theme" placement="bottom" delay={0}>
                <button
                  type="button"
                  class="flex items-center justify-center w-8 h-8 rounded cursor-pointer hover:bg-muted/60 transition-colors"
                  onClick={() => theme.toggleTheme()}
                  aria-label="Toggle theme"
                >
                  {theme.resolvedTheme() === 'light' ? <Moon class="w-4 h-4" /> : <Sun class="w-4 h-4" />}
                </button>
              </Tooltip>
            </div>
          }
          bottomBarItems={
            <>
              <div class="flex items-center gap-2 min-w-0">
                <BottomBarItem class="min-w-0">
                  <span class="truncate">{envName()}</span>
                </BottomBarItem>
                <BottomBarItem class="min-w-0">
                  <span class="truncate">{envId() || '(missing env id)'}</span>
                </BottomBarItem>
              </div>
              <div class="flex items-center gap-2">
                <StatusIndicator status={status()} label={statusLabel()} />
                <Tooltip content={canViewAudit() ? 'Audit log' : 'Admin required'} placement="top" delay={0}>
                  <BottomBarItem
                    onClick={canViewAudit() ? () => setAuditOpen(true) : undefined}
                    class={canViewAudit() ? undefined : 'opacity-60 pointer-events-none'}
                  >
                    Audit log
                  </BottomBarItem>
                </Tooltip>
                <BottomBarItem
                  onClick={reconnectDisabled() ? undefined : () => void reconnect()}
                  class={reconnectDisabled() ? 'opacity-60 pointer-events-none' : undefined}
                >
                  {reconnectLabel()}
                </BottomBarItem>
              </div>
            </>
          }
        >
          <div class="h-full min-h-0 overflow-hidden flex flex-col">
            <Show when={connectError()}>
              <Panel class="h-auto rounded-none border-0 border-b border-error/40">
                <PanelContent class="p-3 text-xs">
                  <div class="text-error font-medium">Connection failed</div>
                  <div class="text-muted-foreground break-words">{connectError()}</div>
                </PanelContent>
              </Panel>
            </Show>

            <div class="flex-1 min-h-0 overflow-hidden relative">
              <Show when={localAccessGateVisible()} fallback={<ActivityAppsMain activeId={() => layout.sidebarActiveTab()} />}>
                {localAccessGatePanel()}
              </Show>
            </div>
          </div>

          <AuditLogDialog open={auditOpen()} envId={envId()} onClose={() => setAuditOpen(false)} />
          <AskFlowerComposerWindow
            open={askFlowerComposerOpen()}
            intent={askFlowerComposerIntent()}
            anchor={askFlowerComposerAnchor()}
            onClose={closeAskFlowerComposer}
            onSend={submitAskFlowerComposer}
          />
        </Shell>
        </AIChatProviderBridge>
      </FloeRegistryRuntime>
    </EnvContext.Provider>
  );
}
