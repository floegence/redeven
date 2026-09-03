import { Show, createEffect, createSignal, onCleanup, type Component } from 'solid-js';
import { Dynamic, render } from 'solid-js/web';
import { afterEach, vi } from 'vitest';
import type { UIFirstSelectionEvent } from '@floegence/floe-webapp-core';

import {
  FlowerSurface as FlowerSurfaceComponent,
  createFlowerComposerDraftCoordinator,
  type FlowerComposerDraftCoordinator,
  type FlowerCompanionPresenceProjection,
  type FlowerSurfaceProps,
  type FlowerSurfaceNotification,
  type FlowerThreadFocusRequest,
} from '../../../../flower_ui/src';
import type { FlowerThreadSwitcherCopy } from '../../../../flower_ui/src/threads/FlowerThreadSwitcher';

const FlowerSurface: Component<Omit<FlowerSurfaceProps, 'draftCoordinator'>> = (props) => {
  const legacy = props.adapter as TestFlowerSurfaceAdapter;
  const adapter = props.adapter.connectLiveStream
    ? props.adapter
    : { ...props.adapter, connectLiveStream: (input: FlowerLiveStreamConnectInput) => testLiveStreamFromLegacyFixture(legacy, input) };
  return <FlowerSurfaceComponent {...props} adapter={adapter} draftCoordinator={createFlowerComposerDraftCoordinator()} />;
};
import type {
	FlowerActivityItem,
	FlowerActivityTimelineBlock,
	FlowerApprovalCommandResult,
	FlowerInputRequest,
  FlowerRouterDecision,
  FlowerSettingsDraft,
  FlowerSurfaceAdapter,
  FlowerSettingsSnapshot,
  FlowerThreadReadStatus,
  FlowerThreadView,
  FlowerThreadSnapshot,
  FlowerSubmitInputReceipt,
  FlowerTurnLaunchReceipt,
  FlowerActivityStatus,
  FlowerSubagentDetail,
  FlowerSubagentSummary,
  FlowerLiveStreamConnectInput,
  FlowerLiveStreamEnvelope,
  FlowerRuntimeCurrentView,
  FlowerRuntimeCurrentItem,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

export type TestFlowerSurfaceAdapter = FlowerSurfaceAdapter & Readonly<{
  listThreadLiveEvents?: (threadID: string, afterSeq: number, limit?: number) => Promise<Readonly<{
    events: readonly Readonly<{ seq: number }>[];
    next_cursor: number;
  }>>;
}>;

async function* testLiveStreamFromLegacyFixture(
  adapter: TestFlowerSurfaceAdapter,
  input: FlowerLiveStreamConnectInput,
): AsyncIterable<FlowerLiveStreamEnvelope> {
  const summaries = await adapter.listThreads();
  const cursors = new Map<string, number>();
  yield {
    schema_version: 1,
    kind: 'ready',
    summaries,
  };
  if (!adapter.listThreadLiveEvents) {
    await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
    return;
  }
  while (!input.signal.aborted) {
    for (const summary of summaries) {
      const threadID = summary.thread_id;
      const response = await adapter.listThreadLiveEvents(threadID, cursors.get(threadID) ?? 0, 100);
      if (input.signal.aborted) return;
      if (response.events.length > 0) {
        for (const event of response.events) {
          cursors.set(threadID, Math.max(cursors.get(threadID) ?? 0, event.seq));
        }
        yield {
          schema_version: 1,
          kind: 'ready',
          summaries: await adapter.listThreads(),
        };
      }
      cursors.set(threadID, Math.max(cursors.get(threadID) ?? 0, response.next_cursor));
    }
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 20);
      input.signal.addEventListener('abort', () => {
        window.clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }
}

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
    Globe: Icon,
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

vi.mock('@floegence/floe-webapp-core/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floegence/floe-webapp-core/ui')>();
  return {
  createFloatingPresence: actual.createFloatingPresence,
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
        data-flower-primary-action={props['data-flower-primary-action']}
        onPointerDown={props.onPointerDown}
        onClick={props.onClick}
      >
        {props.icon ? <Dynamic component={props.icon} /> : null}
        <Show when={props.loading}><span data-floe-button-spinner="true" aria-hidden="true" /></Show>
        {props.children}
      </button>
    );
  },
  FloatingWindow: (props: any) => {
    const presence = actual.createFloatingPresence({
      open: () => Boolean(props.open),
      exitDurationMs: 0,
      reducedMotionExitDurationMs: 0,
    });
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
      <Show when={presence.mounted()}>
        <div
          role="dialog"
          data-floe-geometry-surface="floating-window"
          data-floe-floating-window-surface="true"
          data-floe-floating-window-state="active"
          data-floating-presence={presence.state()}
          aria-hidden={presence.exiting() ? 'true' : undefined}
          class={`floe-floating-presence ${props.class ?? ''}`}
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
    const {
      children, layerRef, position: _position, owner: _owner, estimatedSize: _estimatedSize, clamp: _clamp,
      class: className, style, ...rest
    } = props;
    return (
      <div
        ref={(node) => layerRef?.(node)}
        class={className}
        style={{
          ...(style ?? {}),
          position: 'fixed',
          left: `${props.position?.x ?? 0}px`,
          top: `${props.position?.y ?? 0}px`,
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
  ConfirmDialog: (props: any) => (
    <Show when={props.open}>
      <div role="alertdialog" aria-label={props.title}>
        <h2>{props.title}</h2>
        <div>{props.children}</div>
        <button type="button" disabled={props.loading} onClick={() => props.onOpenChange?.(false)}>
          {props.cancelText ?? 'Cancel'}
        </button>
        <button type="button" disabled={props.loading} onClick={props.onConfirm}>
          {props.confirmText}
        </button>
      </div>
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
  };
});

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
    defaults: { permission_type: 'approval_required' },
    model_profile: {
      schema_version: 1,
      current_model_id: 'openai/gpt-5.2',
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

export function readStatus(isUnread = false, revision = 2, _status = 'idle'): FlowerThreadReadStatus {
  return {
    is_unread: isUnread,
    snapshot: { activity_revision: revision },
    read_state: {
      last_seen_activity_revision: isUnread ? Math.max(0, revision - 1) : revision,
    },
  };
}

export function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  const value: FlowerThreadSnapshot = {
    thread_id: 'thread-1',
    title: 'Deploy plan',
    model_id: 'openai/gpt-5.2',
    working_dir: '/workspace/redeven',
    settings_revision: 1,
    created_at_ms: 1,
    updated_at_ms: 2,
    status: 'idle',
    source_label: 'Local Environment',
    target_labels: [],
    read_status: readStatus(false),
    messages: [
      {
        id: 'm1',
        turn_id: 'turn-1',
        role: 'user',
        content: 'Plan deploy',
        status: 'complete',
        created_at_ms: 1,
      },
    ],
    ...overrides,
    title_status: overrides.title_status ?? 'ready',
  };
  if ((value.status === 'running' || value.status === 'waiting_approval' || value.status === 'waiting_user') && !value.active_run_id) {
    return { ...value, active_run_id: `run:${value.thread_id}` };
  }
  return value;
}

export function liveBootstrap(threadValue: FlowerThreadSnapshot, version = 0): FlowerThreadView {
  return { thread: threadValue, current: runtimeCurrentView(threadValue, Math.max(0, version)) };
}

export const TEST_CLIENT_REQUEST_ID = 'client_test_request';

export function launchReceipt(
  threadID: string,
  canonicalID: string,
  kind: 'start' | 'queued' = 'start',
  clientRequestID = TEST_CLIENT_REQUEST_ID,
): FlowerTurnLaunchReceipt & Readonly<{ current: FlowerRuntimeCurrentView }> {
  return {
    client_request_id: clientRequestID,
    thread_id: threadID,
    current: {
      thread_id: threadID,
      view_version: 1,
      activity: 'active',
      ...(kind === 'queued'
        ? { queue: [{ id: canonicalID, request_key: clientRequestID, input: { text: '' } }] }
        : {
            run_id: canonicalID,
            turn_id: canonicalID,
            run_progress: { phase: 'preparing' as const },
            items: [{
              id: `user:${clientRequestID}`,
              turn_id: canonicalID,
              run_id: canonicalID,
              ordinal: 1,
              kind: 'user' as const,
              text: '',
            }],
          }),
    },
  };
}

export function runtimeCurrentView(
  threadValue: FlowerThreadSnapshot,
  version = 1,
): FlowerRuntimeCurrentView {
  const activeTurnID = threadValue.run_progress?.turn_id
    ?? [...threadValue.messages].reverse().find((message) => Boolean(message.turn_id))?.turn_id
    ?? 'turn-fixture';
  const activeRunID = threadValue.active_run_id
    ?? [...threadValue.messages].reverse().find((message) => Boolean(message.run_id))?.run_id
    ?? 'run-fixture';
  const interactions = [
    ...(threadValue.approval_actions ?? []).map((action) => ({
      id: action.action_id,
      turn_id: action.turn_id ?? activeTurnID,
      run_id: action.run_id,
      kind: 'approval' as const,
      tool_call_id: action.tool_id,
      resolved: action.status !== 'pending' || action.state !== 'requested',
      approved: action.state === 'approved',
    })),
    ...(threadValue.input_request ? [{
      id: threadValue.input_request.prompt_id,
      turn_id: activeTurnID,
      run_id: activeRunID,
      kind: 'input' as const,
      resolved: false,
      signal: {
        name: 'ask_user',
        call_id: threadValue.input_request.tool_id,
        payload: threadValue.input_request as unknown as Readonly<Record<string, unknown>>,
      },
    }] : []),
  ];
  let nextOrdinal = 0;
  const items: FlowerRuntimeCurrentItem[] = threadValue.messages.flatMap<FlowerRuntimeCurrentItem>((message) => {
    const activity = message.blocks?.find((block) => block.type === 'activity-timeline');
    if (activity?.type === 'activity-timeline') {
      return activity.items.map((item) => ({
        id: item.item_id,
        turn_id: message.turn_id ?? activeTurnID,
        run_id: message.run_id ?? activeRunID,
        ordinal: ++nextOrdinal,
        kind: 'tool' as const,
        activity: item as unknown as Readonly<Record<string, unknown>>,
      }));
    }
    const inputResponse = message.blocks?.find((block) => block.type === 'input-response');
    if (inputResponse?.type === 'input-response') {
      return [{
        id: message.id,
        turn_id: message.turn_id ?? activeTurnID,
        run_id: message.run_id ?? activeRunID,
        ordinal: ++nextOrdinal,
        kind: 'interaction' as const,
        interaction: {
          id: message.id,
          turn_id: message.turn_id ?? activeTurnID,
          run_id: message.run_id ?? activeRunID,
          kind: 'input' as const,
          resolved: true,
          input: {
            summary: '',
            questions: inputResponse.questions.map((question) => ({
              id: question.question_id,
              prompt: question.question,
              kind: 'write',
              ...(question.redacted ? { secret: true } : {}),
            })),
          },
          resolution: {
            accepted: true,
            ...(inputResponse.questions.some((question) => question.redacted) ? { redacted: true } : {}),
            input: Object.fromEntries(inputResponse.questions.flatMap((question) => (
              question.redacted ? [] : [[question.question_id, question.answer ?? '']]
            ))),
          },
        },
      }];
    }
    return [{
      id: message.id,
      turn_id: message.turn_id ?? activeTurnID,
      run_id: message.run_id ?? activeRunID,
      ordinal: ++nextOrdinal,
      kind: message.role === 'user' ? 'user' as const : 'assistant' as const,
      text: message.content,
    }];
  });
  return {
    thread_id: threadValue.thread_id,
    view_version: version,
    activity: threadValue.status === 'idle' || threadValue.status === 'success' || threadValue.status === 'failed' || threadValue.status === 'canceled'
      ? 'idle'
      : 'active',
    ...(threadValue.active_run_id ? { run_id: threadValue.active_run_id } : {}),
    ...(activeTurnID ? { turn_id: activeTurnID } : {}),
    ...(threadValue.run_progress ? { run_progress: { phase: threadValue.run_progress.phase } } : {}),
    ...(threadValue.status === 'success' ? { last_outcome: 'completed' as const } : {}),
    ...(threadValue.status === 'failed' ? { last_outcome: 'failed' as const } : {}),
    ...(threadValue.status === 'canceled' ? { last_outcome: 'cancelled' as const } : {}),
    items,
    queue: (threadValue.queued_turns ?? []).map((queued) => ({
      id: queued.queue_id,
      request_key: queued.queue_id,
      input: { text: queued.prompt },
    })),
    interactions,
  };
}

export function inputAdmissionReceipt(
  threadID: string,
  promptID: string,
  turnID = 'turn-input-response',
  runID = 'run-input-response',
): FlowerSubmitInputReceipt {
  return {
    thread_id: threadID,
    consumed_prompt_id: promptID,
    current: {
      thread_id: threadID,
      view_version: 1,
      activity: 'active',
      run_id: runID,
      turn_id: turnID,
      run_progress: { phase: 'preparing' },
      interactions: [],
    },
  };
}

export function approvalCommandResult(
  threadID: string,
  interactionID: string,
  approved: boolean,
  version = 1,
): FlowerApprovalCommandResult {
  return {
    ok: true,
    current: {
      thread_id: threadID,
      view_version: version,
      activity: 'active',
      run_id: `run:${interactionID}`,
      interactions: [{ id: interactionID, turn_id: 'turn-fixture', run_id: 'run-fixture', kind: 'approval', resolved: true, approved }],
    },
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
  thread_id: string;
  run_id: string;
  turn_id: string;
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
    declined?: number;
    canceled?: number;
    approval?: number;
  } = {};
  for (const item of args.items) {
    if (item.status === 'pending') counts.pending = (counts.pending ?? 0) + 1;
    if (item.status === 'running') counts.running = (counts.running ?? 0) + 1;
    if (item.status === 'waiting') counts.waiting = (counts.waiting ?? 0) + 1;
    if (item.status === 'success') counts.success = (counts.success ?? 0) + 1;
    if (item.status === 'error') counts.error = (counts.error ?? 0) + 1;
    if (item.status === 'declined') counts.declined = (counts.declined ?? 0) + 1;
    if (item.status === 'canceled') counts.canceled = (counts.canceled ?? 0) + 1;
    if (item.requires_approval) counts.approval = (counts.approval ?? 0) + 1;
  }
  return {
    type: 'activity-timeline' as const,
    schema_version: 1,
    thread_id: args.thread_id,
    run_id: args.run_id,
    turn_id: args.turn_id,
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
    thread_id: 'thread-child-review',
    task_name: 'Review API contract',
    task_description: 'Review the API boundary.',
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
  const summary = overrides.summary ?? subagentSummary();
  return {
    summary,
    current: {
      thread_id: summary.thread_id,
      view_version: 7,
      activity: 'active',
      turn_id: 'child-turn-1',
      run_id: 'child-run-1',
      items: [
        {
          id: 'child-user-follow-up', turn_id: 'child-turn-1', run_id: 'child-run-1', ordinal: 1,
          kind: 'user', text: 'Review the API boundary.', created_at: new Date(110).toISOString(),
        },
        {
          id: 'call-terminal-running', turn_id: 'child-turn-1', run_id: 'child-run-1', ordinal: 2,
          kind: 'tool', created_at: new Date(130).toISOString(),
          activity: { ...activityItem({
            item_id: 'call-terminal-running', tool_id: 'call-terminal-running', tool_name: 'terminal.exec',
            renderer: 'terminal', label: 'go test ./internal/ui', status: 'running',
            payload: { command: 'go test ./internal/ui', status: 'running' },
          }) },
        },
        {
          id: 'call-terminal', turn_id: 'child-turn-1', run_id: 'child-run-1', ordinal: 3,
          kind: 'tool', created_at: new Date(140).toISOString(),
          activity: { ...activityItem({
            item_id: 'call-terminal', tool_id: 'call-terminal', tool_name: 'terminal.exec',
            renderer: 'terminal', label: 'go test ./internal/ai', status: 'success',
            payload: {
              command: 'go test ./internal/ai', status: 'success', output: 'PASS ./internal/ai',
              first_seq: 1, last_seq: 1, latest_seq: 1, has_more: false, truncated: false,
              content_ref: 'hash-tool-result',
            },
          }) },
        },
        {
          id: 'child-turn-1', turn_id: 'child-turn-1', run_id: 'child-run-1', ordinal: 4,
          kind: 'assistant', text: 'Child handoff ready.', created_at: new Date(160).toISOString(), live: true,
        },
      ],
    },
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

export function adapter(configured = true): TestFlowerSurfaceAdapter {
  return {
    runtime: {
      runtime_id: 'runtime',
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: 'Local Environment',
      subtitle: 'Global runtime',
    },
    loadSettings: vi.fn(async () => settingsSnapshot(configured)),
    saveDefaultPermission: vi.fn(async () => settingsSnapshot(configured)),
    saveModelProfile: vi.fn(async () => settingsSnapshot(configured)),
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
      },
    })),
    resolveHandler: vi.fn(async () => decision()),
    persistDefaultModel: vi.fn(async () => settingsSnapshot(configured)),
    createAttachmentStagingScope: vi.fn(async (targetID?: string) => ({
      staging_scope_id: `staging_${targetID ?? 'new'}`,
      target_id: targetID ?? TEST_CLIENT_REQUEST_ID,
      capability: `secret_${targetID ?? 'new'}`,
      expires_at_unix_ms: Date.now() + 60_000,
    })),
    releaseAttachmentStagingScope: vi.fn(async () => undefined),
    launchTurn: vi.fn(async (input) => {
      const receipt = launchReceipt(input.thread_id ?? 'thread-1', 'turn-launch');
      return { ...receipt, client_request_id: input.client_request_id };
    }),
    retryThread: vi.fn(async (threadID: string) => liveBootstrap(thread({ thread_id: threadID, status: 'running' }))),
    stopThread: vi.fn(async () => undefined),
    submitInput: vi.fn(async (input) => inputAdmissionReceipt(input.thread_id, input.prompt_id)),
    submitApproval: vi.fn(async (input) => approvalCommandResult(input.thread_id, input.interaction_id, input.approved)),
    modelSourceRecovery: {
      describe: (status) => `Desktop source is ${status.state}.`,
      localSettings: { label: 'Local Flower settings', run: vi.fn(async () => undefined) },
      runtimeSettings: { label: 'Runtime settings', run: vi.fn(async () => undefined) },
      connectionCenter: { label: 'Connection center', run: vi.fn(async () => undefined) },
    },
  };
}

export function mutableSettingsAdapter(configured = true): FlowerSurfaceAdapter & Readonly<{
  saveDefaultPermission: ReturnType<typeof vi.fn>;
  saveModelProfile: ReturnType<typeof vi.fn>;
  persistDefaultModel: ReturnType<typeof vi.fn>;
}> {
  let snapshot = settingsSnapshot(configured);
  return {
    ...adapter(configured),
    loadSettings: vi.fn(async () => snapshot),
    saveDefaultPermission: vi.fn(async (permissionType: FlowerSettingsSnapshot['defaults']['permission_type']) => {
      snapshot = {
        ...snapshot,
        defaults: { permission_type: permissionType },
      };
      return snapshot;
    }),
    saveModelProfile: vi.fn(async (draft: FlowerSettingsDraft) => {
      snapshot = {
        ...snapshot,
        model_profile: {
          ...draft.model_profile,
          providers: draft.model_profile.providers.map((provider) => ({
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
    persistDefaultModel: vi.fn(async (modelID: string) => {
      snapshot = {
        ...snapshot,
        model_profile: snapshot.model_profile ? {
          ...snapshot.model_profile,
          current_model_id: modelID,
        } : null,
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
const runtimeDisposers = new WeakMap<HTMLDivElement, () => void>();
const notifications: FlowerSurfaceNotification[] = [];

export function flowerSurfaceNotifications(): readonly FlowerSurfaceNotification[] {
  return notifications;
}

export function clearFlowerSurfaceNotifications(): void {
  notifications.length = 0;
}

const mountFlowerSurface = (
  surfaceAdapter: TestFlowerSurfaceAdapter,
  props: Readonly<{
    focusThreadRequest?: FlowerThreadFocusRequest | null;
    settingsFocusRequest?: number;
    presentation?: 'full' | 'companion';
    companionOpen?: boolean;
    engaged?: boolean;
    transcriptVisible?: boolean;
    companionPresenceOwner?: boolean;
    companionCopy?: FlowerThreadSwitcherCopy;
    companionSummary?: FlowerSurfaceProps['companionSummary'];
    onCompanionOpenRequest?: (threadID?: string) => void;
    onPresenceChange?: (presence: FlowerCompanionPresenceProjection) => void;
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
      settingsFocusRequest={props.settingsFocusRequest}
      presentation={props.presentation}
      companionOpen={props.companionOpen}
      engaged={props.engaged}
      transcriptVisible={props.transcriptVisible}
      companionPresenceOwner={props.companionPresenceOwner}
      companionCopy={props.companionCopy}
      companionSummary={props.companionSummary}
      onCompanionOpenRequest={props.onCompanionOpenRequest}
      onPresenceChange={props.onPresenceChange}
      onFocusThreadRequestConsumed={props.onFocusThreadRequestConsumed}
      onThreadSelectionEvent={props.onThreadSelectionEvent}
    />
  ), runtime));
  return runtime;
};

export function renderSurface(configured = true): HTMLDivElement {
  return mountFlowerSurface(adapter(configured));
}

export function renderSurfaceWithAdapter(surfaceAdapter: TestFlowerSurfaceAdapter): HTMLDivElement {
  return mountFlowerSurface(surfaceAdapter);
}

export function renderSurfaceWithDraftCoordinator(
  surfaceAdapter: TestFlowerSurfaceAdapter,
  draftCoordinator: FlowerComposerDraftCoordinator,
): HTMLDivElement {
  const runtime = document.createElement('div');
  document.body.appendChild(runtime);
  const dispose = render(() => (
    <FlowerSurfaceComponent
      adapter={surfaceAdapter}
      draftCoordinator={draftCoordinator}
      notify={(notification) => notifications.push(notification)}
    />
  ), runtime);
  let disposed = false;
  const disposeOnce = () => {
    if (disposed) return;
    disposed = true;
    runtimeDisposers.delete(runtime);
    dispose();
  };
  runtimeDisposers.set(runtime, disposeOnce);
  disposers.push(disposeOnce);
  return runtime;
}

export function disposeRenderedSurface(runtime: HTMLDivElement): void {
  runtimeDisposers.get(runtime)?.();
}

export function renderSurfaceWithAdapterProps(
  surfaceAdapter: TestFlowerSurfaceAdapter,
  props: Readonly<{
    focusThreadRequest?: FlowerThreadFocusRequest | null;
    settingsFocusRequest?: number;
    presentation?: 'full' | 'companion';
    companionOpen?: boolean;
    engaged?: boolean;
    transcriptVisible?: boolean;
    companionPresenceOwner?: boolean;
    companionCopy?: FlowerThreadSwitcherCopy;
    companionSummary?: FlowerSurfaceProps['companionSummary'];
    onCompanionOpenRequest?: (threadID?: string) => void;
    onPresenceChange?: (presence: FlowerCompanionPresenceProjection) => void;
    onFocusThreadRequestConsumed?: (requestID: string) => void;
    onThreadSelectionEvent?: (event: UIFirstSelectionEvent<string, { source: 'thread-list' }>) => void;
  }>,
): HTMLDivElement {
  return mountFlowerSurface(surfaceAdapter, props);
}

export function renderSurfaceWithCompanionController(
  surfaceAdapter: TestFlowerSurfaceAdapter,
  initialOpen: boolean,
  companionCopy: FlowerThreadSwitcherCopy,
  onCompanionOpenRequest?: (threadID?: string) => void,
): Readonly<{
  runtime: HTMLDivElement;
  setOpen: (open: boolean) => void;
}> {
  const runtime = document.createElement('div');
  document.body.appendChild(runtime);
  const [open, setOpen] = createSignal(initialOpen);
  const dispose = render(() => (
    <FlowerSurface
      adapter={surfaceAdapter}
      notify={(notification) => notifications.push(notification)}
      presentation="companion"
      companionOpen={open()}
      engaged
      transcriptVisible
      companionCopy={companionCopy}
      onCompanionOpenRequest={onCompanionOpenRequest}
    />
  ), runtime);
  disposers.push(dispose);
  return {
    runtime,
    setOpen,
  };
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
