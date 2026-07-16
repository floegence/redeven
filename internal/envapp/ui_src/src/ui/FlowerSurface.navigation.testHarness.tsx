import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Dynamic, render } from 'solid-js/web';
import { afterEach, vi } from 'vitest';
import type { UIFirstSelectionEvent } from '@floegence/floe-webapp-core';

import { FlowerSurface, type FlowerSurfaceNotification, type FlowerThreadFocusRequest } from '../../../../flower_ui/src';
import type {
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerInputRequest,
  FlowerRouterDecision,
  FlowerSettingsDraft,
  FlowerSurfaceAdapter,
  FlowerSettingsSnapshot,
  FlowerThreadReadStatus,
  FlowerLiveBootstrap,
  FlowerThreadSnapshot,
  FlowerActivityStatus,
  FlowerModelIOStatus,
  FlowerContextCompaction,
  FlowerTimelineDecoration,
  FlowerSubagentDetail,
  FlowerSubagentSummary,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => {
  const Icon = (props: any) => <span data-icon class={props.class} />;
  return {
    Activity: Icon,
    AlertCircle: Icon,
    AlertTriangle: Icon,
    ArrowUp: Icon,
    Bot: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    ChevronRight: Icon,
    Clock: Icon,
    Code: Icon,
    Copy: Icon,
    ExternalLink: Icon,
    FileText: Icon,
    Folder: Icon,
    FolderOpen: Icon,
    GitBranch: Icon,
    GripVertical: Icon,
    MoreHorizontal: Icon,
    Paperclip: Icon,
    Pencil: Icon,
    Pin: Icon,
    Plus: Icon,
    Refresh: Icon,
    Search: Icon,
    Send: Icon,
    Settings: Icon,
    Shield: Icon,
    Sparkles: Icon,
    Stop: Icon,
    Terminal: Icon,
    Trash: Icon,
    X: Icon,
    XCircle: Icon,
    Zap: Icon,
  };
});

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Button: (props: any) => {
    return (
      <button
        type="button"
        class={props.class}
        aria-label={props['aria-label']}
        aria-busy={props['aria-busy']}
        title={props.title}
        disabled={props.disabled}
        data-loading={props.loading ? 'true' : undefined}
        onClick={props.onClick}
      >
        {props.icon ? <Dynamic component={props.icon} /> : null}
        <Show when={props.loading}><span data-floe-button-spinner="true" aria-hidden="true" /></Show>
        {props.children}
      </button>
    );
  },
  FloatingWindow: (props: any) => {
    createEffect(() => {
      if (!props.open) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        props.onOpenChange?.(false);
      };
      window.addEventListener('keydown', onKeyDown);
      onCleanup(() => window.removeEventListener('keydown', onKeyDown));
    });
    return (
      <Show when={props.open}>
        <div
          role="dialog"
          data-floe-geometry-surface="floating-window"
          class={props.class}
          style={{
            width: `${props.defaultSize?.width ?? 400}px`,
            height: `${props.defaultSize?.height ?? 300}px`,
          }}
        >
          <div data-floe-floating-window-titlebar="true">
            <span>{props.title}</span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => props.onOpenChange?.(false)}
            />
          </div>
          <div class="flex-1 overflow-auto p-3">{props.children}</div>
          <Show when={props.footer}>{props.footer}</Show>
        </div>
      </Show>
    );
  },
  SurfaceFloatingLayer: (props: any) => {
    const { children, layerRef, position, class: className, style, ...rest } = props;
    return (
      <div
        ref={(node) => layerRef?.(node)}
        class={className}
        style={{
          ...(style ?? {}),
          left: `${position?.x ?? 0}px`,
          top: `${position?.y ?? 0}px`,
        }}
        data-floe-local-interaction-surface="true"
        {...rest}
      >
        {children}
      </div>
    );
  },
  Checkbox: (props: any) => (
    <input
      type="checkbox"
      checked={!!props.checked}
      disabled={props.disabled}
      onChange={(event) => props.onChange?.((event.currentTarget as HTMLInputElement).checked)}
    />
  ),
  Dialog: (props: any) => (
    <Show when={props.open}>
      <div role="dialog">{props.children}</div>
    </Show>
  ),
  DirectoryPicker: (props: any) => {
    const [selectedPath, setSelectedPath] = createSignal(props.initialPath ?? '/');
    return (
      <Show when={props.open}>
        <div role="dialog" aria-label={props.title} data-directory-picker="true">
          <div>{props.homeLabel}</div>
          {(props.files ?? []).map((file: any) => (
            <button
              type="button"
              data-directory-picker-entry={file.path}
              onClick={() => setSelectedPath(file.path)}
            >
              {file.name}
            </button>
          ))}
          <button
            type="button"
            data-directory-picker-confirm="true"
            onClick={() => props.onSelect?.(selectedPath())}
          >
            {props.confirmText}
          </button>
        </div>
      </Show>
    );
  },
  Input: (props: any) => (
    <input
      class={props.class}
      value={props.value}
      placeholder={props.placeholder}
      onInput={props.onInput}
      disabled={props.disabled}
    />
  ),
  ProcessingIndicator: (props: any) => <span class={props.class}>{props.children}</span>,
  Select: (props: any) => (
    <select
      class={props.class}
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange?.((event.currentTarget as HTMLSelectElement).value)}
    >
      {(props.options ?? []).map((option: any) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
  Tag: (props: any) => <span class={props.class}>{props.children}</span>,
}));

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function retiredHandlerUnavailableCopy(): string {
  return ['Flower handler', 'unavailable'].join(' ');
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await wait(10);
    await flush();
    if (condition()) return;
  }
  throw new Error('Timed out waiting for FlowerSurface condition.');
}

export function settingsSnapshot(configured = true): FlowerSettingsSnapshot {
  return {
    config: {
      schema_version: 1,
      current_model_id: 'openai/gpt-5.2',
      permission_type: 'approval_required',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          models: [
            {
              model_name: 'gpt-5.2',
              context_window: 400000,
              input_modalities: ['text'],
            },
          ],
        },
      ],
    },
    provider_secrets: [
      {
        provider_id: 'openai',
        provider_api_key_configured: configured,
        web_search_api_key_configured: false,
      },
    ],
  };
}

export function readStatus(isUnread = false, revision = 2, status = 'idle'): FlowerThreadReadStatus {
  const signature = `status:${status}\u001factivity:${revision}`;
  return {
    is_unread: isUnread,
    snapshot: {
      activity_revision: revision,
      last_message_at_unix_ms: revision,
      activity_signature: signature,
    },
    read_state: {
      last_seen_activity_revision: isUnread ? Math.max(0, revision - 1) : revision,
      last_read_message_at_unix_ms: isUnread ? Math.max(0, revision - 1) : revision,
      last_seen_activity_signature: isUnread ? `status:${status}\u001factivity:${Math.max(0, revision - 1)}` : signature,
    },
  };
}

export function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-1',
    title: 'Deploy plan',
    model_id: 'openai/gpt-5.2',
    working_dir: '/workspace/redeven',
    created_at_ms: 1,
    updated_at_ms: 2,
    status: 'idle',
    source_label: 'Local Environment',
    target_labels: [],
    read_status: readStatus(false),
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Plan deploy',
        status: 'complete',
        created_at_ms: 1,
      },
    ],
    ...overrides,
  };
}

export function modelIOStatus(overrides: Partial<FlowerModelIOStatus> = {}): FlowerModelIOStatus {
  return {
    phase: 'streaming',
    run_id: 'run-live',
    updated_at_ms: 3,
    ...overrides,
  };
}

export function liveBootstrap(threadValue: FlowerThreadSnapshot, cursor = 0): FlowerLiveBootstrap {
  const modelIORunID = threadValue.model_io_status?.run_id;
  const activeRunID = modelIORunID || threadValue.active_run_id;
  const hasApprovalActions = threadValue.approval_actions !== undefined;
  const approvalActions = Object.fromEntries((threadValue.approval_actions ?? []).map((action) => [action.action_id, action]));
  const inputRequests = threadValue.status === 'waiting_user' && threadValue.input_request
    ? { [threadValue.input_request.prompt_id]: threadValue.input_request }
    : {};
  return {
    schema_version: 1,
    endpoint_id: 'test-runtime',
    thread_id: threadValue.thread_id,
    stream_generation: 1,
    cursor,
    retained_from_seq: 1,
    thread: threadValue,
    timeline_messages: threadValue.messages,
    live_state: {
      thread_patch: {
        ...(threadValue.queued_turn_count !== undefined ? { queued_turn_count: threadValue.queued_turn_count } : {}),
      },
      runs: activeRunID
        ? { [activeRunID]: { run_id: activeRunID, status: threadValue.status } }
        : {},
      ...(threadValue.model_io_status ? { model_io: threadValue.model_io_status } : {}),
      ...(threadValue.context_usage ? { context_usage: threadValue.context_usage } : {}),
      ...(threadValue.context_compactions ? { context_compactions: threadValue.context_compactions as readonly FlowerContextCompaction[] } : {}),
      ...(threadValue.timeline_decorations ? { timeline_decorations: threadValue.timeline_decorations as readonly FlowerTimelineDecoration[] } : {}),
      ...(hasApprovalActions ? { approval_actions: approvalActions } : {}),
      ...(threadValue.approval_queue ? { approval_queue: threadValue.approval_queue } : {}),
      input_requests: inputRequests,
    },
    read_status: threadValue.read_status,
    generated_at_ms: Math.max(Date.now(), threadValue.updated_at_ms),
  };
}

export function activityItem(overrides: Partial<FlowerActivityItem> = {}): FlowerActivityItem {
  return {
    item_id: 'tool-terminal',
    tool_id: 'tool-terminal',
    tool_name: 'terminal.exec',
    kind: 'tool',
    status: 'success',
    severity: 'quiet',
    needs_attention: false,
    requires_approval: false,
    ...overrides,
  };
}

export function activityTimeline(args: {
  run_id?: string;
  turn_id?: string;
  status?: FlowerActivityStatus;
  severity?: 'quiet' | 'normal' | 'warning' | 'error' | 'blocking';
  needs_attention?: boolean;
  items: readonly FlowerActivityItem[];
  file_actions?: FlowerActivityTimelineBlock['file_actions'];
}): FlowerActivityTimelineBlock {
  const status = args.status ?? 'success';
  const severity = args.severity ?? (status === 'success' ? 'quiet' : status === 'error' ? 'error' : 'normal');
  const counts: {
    pending?: number;
    running?: number;
    waiting?: number;
    success?: number;
    error?: number;
    canceled?: number;
    approval?: number;
  } = {};
  for (const item of args.items) {
    if (item.status === 'pending') counts.pending = (counts.pending ?? 0) + 1;
    if (item.status === 'running') counts.running = (counts.running ?? 0) + 1;
    if (item.status === 'waiting') counts.waiting = (counts.waiting ?? 0) + 1;
    if (item.status === 'success') counts.success = (counts.success ?? 0) + 1;
    if (item.status === 'error') counts.error = (counts.error ?? 0) + 1;
    if (item.status === 'canceled') counts.canceled = (counts.canceled ?? 0) + 1;
    if (item.requires_approval) counts.approval = (counts.approval ?? 0) + 1;
  }
  return {
    type: 'activity-timeline' as const,
    schema_version: 1,
    run_id: args.run_id ?? 'run-1',
    turn_id: args.turn_id ?? 'm-1',
    summary: {
      status,
      severity,
      needs_attention: args.needs_attention ?? args.items.some((item) => item.needs_attention),
      total_items: args.items.length,
      counts,
    },
    items: args.items,
    ...(args.file_actions ? { file_actions: args.file_actions } : {}),
  };
}

export function subagentSummary(overrides: Partial<FlowerSubagentSummary> = {}): FlowerSubagentSummary {
  return {
    parent_thread_id: 'thread-parent-subagents',
    subagent_id: 'thread-child-review',
    thread_id: 'thread-child-review',
    task_name: 'Review API contract',
    task_description: 'Review the API boundary.',
    title: 'Review API contract',
    agent_type: 'reviewer',
    status: 'running',
    can_send_input: false,
    can_interrupt: true,
    can_close: true,
    created_at_ms: 100,
    updated_at_ms: 160,
    ...overrides,
  };
}

export function subagentDetail(overrides: Partial<FlowerSubagentDetail> = {}): FlowerSubagentDetail {
  return {
    summary: {
      parent_thread_id: 'thread-parent-subagents',
      subagent_id: 'thread-child-review',
      thread_id: 'thread-child-review',
      task_name: 'Review API contract',
      title: 'Review API contract',
      agent_type: 'reviewer',
      status: 'running',
      last_message: 'Reading the API boundary.',
      can_send_input: false,
      can_interrupt: true,
      can_close: true,
      created_at_ms: 100,
      updated_at_ms: 160,
    },
    timeline: [
      {
        ordinal: 1,
        kind: 'user_message',
        created_at_ms: 110,
        message: {
          role: 'user',
          text: 'Review the API boundary.',
        },
      },
      {
        ordinal: 2,
        kind: 'tool_call',
        created_at_ms: 130,
        tool_call: {
          id: 'call-terminal-running',
          name: 'terminal.exec',
          args_preview: 'go test ./internal/ui',
        },
      },
      {
        ordinal: 3,
        kind: 'tool_result',
        created_at_ms: 140,
        tool_result: {
          call_id: 'call-terminal',
          tool_name: 'terminal.exec',
          preview: 'PASS ./internal/ai',
          truncated: false,
          content_sha256: 'hash-tool-result',
        },
      },
      {
        ordinal: 4,
        kind: 'assistant_message',
        created_at_ms: 160,
        message: {
          role: 'assistant',
          text: 'Child handoff ready.',
        },
      },
    ],
    activity: activityTimeline({
      run_id: 'subagent:thread-child-review',
      turn_id: 'child-canonical',
      items: [
        activityItem({
          item_id: 'call-terminal-running',
          tool_id: 'call-terminal-running',
          tool_name: 'terminal.exec',
          renderer: 'terminal',
          label: 'go test ./internal/ui',
          status: 'running',
          payload: {
            command: 'go test ./internal/ui',
            status: 'running',
          },
        }),
        activityItem({
          item_id: 'call-terminal',
          tool_id: 'call-terminal',
          tool_name: 'terminal.exec',
          renderer: 'terminal',
          label: 'go test ./internal/ai',
          status: 'success',
          payload: {
            command: 'go test ./internal/ai',
            status: 'success',
			output: 'PASS ./internal/ai',
			first_seq: 1,
			last_seq: 1,
			latest_seq: 1,
			has_more: false,
			truncated: false,
            content_ref: 'hash-tool-result',
          },
        }),
      ],
    }),
    next_ordinal: 5,
    generated_at_ms: 170,
    ...overrides,
  };
}

export function inputRequest(overrides: Partial<FlowerInputRequest> = {}): FlowerInputRequest {
  return {
    prompt_id: 'prompt-ask-user',
    message_id: 'message-ask-user',
    tool_id: 'tool-ask-user',
    tool_name: 'ask_user',
    reason_code: 'needs_user_choice',
    public_summary: 'Choose the deployment target before Flower continues.',
    questions: [
      {
        id: 'target',
        header: 'Deployment target',
        question: 'Where should Flower deploy this change?',
        response_mode: 'select',
        choices: [
          {
            choice_id: 'staging',
            label: 'Staging',
            description: 'Use the safe validation environment.',
            kind: 'select',
          },
          {
            choice_id: 'production',
            label: 'Production',
            description: 'Use the live environment.',
            kind: 'select',
          },
        ],
      },
    ],
    ...overrides,
  };
}

export function decision(): FlowerRouterDecision {
  return {
    decision_id: 'decision-1',
    decision_revision: 1,
    route: 'env_local',
    reason_code: 'runtime_available',
    selected_handler: {
      handler_id: 'local-environment',
      handler_kind: 'env_local',
      display_name: 'Local Environment',
      carrier_kind: 'runtime',
      state: 'online',
      selection_source: 'router_default',
      supports_thread_kinds: ['chat'],
    },
    available_handlers: [],
    unavailable_handlers: [],
    handler_selection: {
      can_switch: false,
      requires_user_visible_confirmation: true,
    },
    decision_scope: {
      thread_kind: 'chat',
      client_surface: 'flower_surface',
    },
    runtime_presence: {
      schema_version: 1,
      runtime_id: 'local-environment',
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: 'Local Environment',
      state: 'online',
      endpoint: { visibility: 'local' },
      capabilities: ['chat'],
      last_seen_at_unix_ms: 1,
    },
    allowed_actions: ['start_thread'],
    ui_chips: [{ kind: 'runtime', label: 'Using Local AI Profile', tone: 'normal' }],
    blocker: null,
    created_at_unix_ms: 1,
  };
}

export function blockedDecision(): FlowerRouterDecision {
  return {
    ...decision(),
    decision_id: 'decision-blocked',
    route: 'blocked',
    reason_code: 'runtime_not_configured',
    selected_handler: null,
    available_handlers: [],
    ui_chips: [{ kind: 'runtime', label: 'Flower needs setup', tone: 'warning' }],
    blocker: {
      code: 'runtime_not_configured',
      message: 'Configure Flower before chatting.',
    },
  };
}

export function adapter(configured = true): FlowerSurfaceAdapter {
  return {
    runtime: {
      runtime_id: 'runtime',
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: 'Local Environment',
      subtitle: 'Global runtime',
    },
    loadSettings: vi.fn(async () => settingsSnapshot(configured)),
    saveSettings: vi.fn(async () => settingsSnapshot(configured)),
    listThreads: vi.fn(async () => [
      thread(),
      thread({ thread_id: 'thread-2', title: 'Review branch', updated_at_ms: 3 }),
    ]),
    loadThread: vi.fn(async (threadID: string) => liveBootstrap(thread({ thread_id: threadID }))),
    listThreadLiveEvents: vi.fn(async () => ({ stream_generation: 1, events: [], next_cursor: 0, retained_from_seq: 1 })),
    loadSubagentDetail: vi.fn(async () => subagentDetail()),
    readTerminalProcess: vi.fn(async () => ({
      process_id: 'tp_default',
      status: 'running',
      output: '',
	  first_seq: 0,
	  last_seq: 0,
	  latest_seq: 0,
	  has_more: false,
	  truncated: false,
    })),
    markThreadRead: vi.fn(async (_threadID: string, snapshot) => ({
      is_unread: false,
      snapshot,
      read_state: {
        last_seen_activity_revision: snapshot.activity_revision,
        last_read_message_at_unix_ms: snapshot.last_message_at_unix_ms,
        last_seen_activity_signature: snapshot.activity_signature,
        ...(snapshot.waiting_prompt_id ? { last_seen_waiting_prompt_id: snapshot.waiting_prompt_id } : {}),
      },
    })),
    resolveHandler: vi.fn(async () => decision()),
    setCurrentModel: vi.fn(async () => settingsSnapshot(configured)),
    launchTurn: vi.fn(async () => liveBootstrap(thread())),
    compactThreadContext: vi.fn(async (input) => liveBootstrap(thread({
      thread_id: input.thread_id,
      status: 'running',
    }))),
    stopThread: vi.fn(async (threadID: string) => liveBootstrap(thread({ thread_id: threadID, status: 'canceled' }))),
    submitInput: vi.fn(async () => liveBootstrap(thread({ status: 'running' }))),
    submitApproval: vi.fn(async () => ({ ok: true, current_cursor: 1 })),
  };
}

export function mutableSettingsAdapter(configured = true): FlowerSurfaceAdapter & Readonly<{
  saveSettings: ReturnType<typeof vi.fn>;
  setCurrentModel: ReturnType<typeof vi.fn>;
}> {
  let snapshot = settingsSnapshot(configured);
  return {
    ...adapter(configured),
    loadSettings: vi.fn(async () => snapshot),
    saveSettings: vi.fn(async (draft: FlowerSettingsDraft) => {
      snapshot = {
        ...snapshot,
        config: {
          ...draft.config,
          providers: draft.config.providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            type: provider.type,
            base_url: provider.base_url,
            web_search: provider.web_search,
            models: provider.models,
          })),
        },
      };
      return snapshot;
    }),
    setCurrentModel: vi.fn(async (modelID: string) => {
      snapshot = {
        ...snapshot,
        config: {
          ...snapshot.config,
          current_model_id: modelID,
        },
      };
      return snapshot;
    }),
  };
}

export function threadOrder(runtime: HTMLElement): string[] {
  return Array.from(runtime.querySelectorAll('[data-thread-id]'))
    .map((node) => node.getAttribute('data-thread-id') ?? '');
}

const disposers: Array<() => void> = [];
const notifications: FlowerSurfaceNotification[] = [];

export function flowerSurfaceNotifications(): readonly FlowerSurfaceNotification[] {
  return notifications;
}

export function clearFlowerSurfaceNotifications(): void {
  notifications.length = 0;
}

const mountFlowerSurface = (
  surfaceAdapter: FlowerSurfaceAdapter,
  props: Readonly<{
    focusThreadRequest?: FlowerThreadFocusRequest | null;
    onFocusThreadRequestConsumed?: (requestID: string) => void;
    onThreadSelectionEvent?: (event: UIFirstSelectionEvent<string, { source: 'thread-list' }>) => void;
  }> = {},
): HTMLDivElement => {
  const runtime = document.createElement('div');
  document.body.appendChild(runtime);
  disposers.push(render(() => (
    <FlowerSurface
      adapter={surfaceAdapter}
      notify={(notification) => {
        notifications.push(notification);
      }}
      focusThreadRequest={props.focusThreadRequest}
      onFocusThreadRequestConsumed={props.onFocusThreadRequestConsumed}
      onThreadSelectionEvent={props.onThreadSelectionEvent}
    />
  ), runtime));
  return runtime;
};

export function renderSurface(configured = true): HTMLDivElement {
  return mountFlowerSurface(adapter(configured));
}

export function renderSurfaceWithAdapter(surfaceAdapter: FlowerSurfaceAdapter): HTMLDivElement {
  return mountFlowerSurface(surfaceAdapter);
}

export function renderSurfaceWithAdapterProps(
  surfaceAdapter: FlowerSurfaceAdapter,
  props: Readonly<{
    focusThreadRequest?: FlowerThreadFocusRequest | null;
    onFocusThreadRequestConsumed?: (requestID: string) => void;
    onThreadSelectionEvent?: (event: UIFirstSelectionEvent<string, { source: 'thread-list' }>) => void;
  }>,
): HTMLDivElement {
  return mountFlowerSurface(surfaceAdapter, props);
}

export function renderSurfaceWithFocusController(
  surfaceAdapter: FlowerSurfaceAdapter,
  initialFocusThreadRequest: FlowerThreadFocusRequest | null,
): Readonly<{
  runtime: HTMLDivElement;
  focusThreadRequest: () => FlowerThreadFocusRequest | null;
  setFocusThreadRequest: (request: FlowerThreadFocusRequest | null) => void;
  consumedRequests: () => readonly string[];
}> {
  const runtime = document.createElement('div');
  document.body.appendChild(runtime);
  const [focusThreadRequest, setFocusThreadRequest] = createSignal<FlowerThreadFocusRequest | null>(initialFocusThreadRequest);
  const consumed: string[] = [];
  disposers.push(render(() => (
    <FlowerSurface
      adapter={surfaceAdapter}
      notify={(notification) => {
        notifications.push(notification);
      }}
      focusThreadRequest={focusThreadRequest()}
      onFocusThreadRequestConsumed={(requestID) => {
        consumed.push(requestID);
        setFocusThreadRequest((current) => (
          current?.request_id === requestID ? null : current
        ));
      }}
    />
  ), runtime));
  return {
    runtime,
    focusThreadRequest,
    setFocusThreadRequest,
    consumedRequests: () => consumed,
  };
}

afterEach(() => {
  while (disposers.length > 0) {
    disposers.pop()?.();
  }
  clearFlowerSurfaceNotifications();
  document.body.innerHTML = '';
});
