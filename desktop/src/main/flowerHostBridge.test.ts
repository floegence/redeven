import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDesktopFlowerHostPlaintextSecretCodec,
  defaultDesktopFlowerHostPaths,
} from './desktopFlowerHostState';
import { startFlowerHostSecretResolver } from './flowerHostSecretResolver';

type MockChild = EventEmitter & {
  stdout: EventEmitter & { setEncoding: (encoding: string) => void };
  stderr: EventEmitter & { setEncoding: (encoding: string) => void };
  exitCode: number | null;
  signalCode: string | null;
  kill: (signal: string) => boolean;
};

const spawnedChildren: MockChild[] = [];
const spawnCalls: Array<{
  executable: string;
  args: readonly string[];
  options: { env?: NodeJS.ProcessEnv };
}> = [];
let startupMode: 'ready' | 'blocked' = 'ready';
let startupAttached = false;
let startupAttachedReports: boolean[] = [];
let startupPID = 4242;
let secretResolverClosed = false;
let fetchStatusOK = true;
let carrierState: 'ready' | 'unreachable' | 'missing' = 'ready';
let threadResponse: unknown = null;
let settingsResponse: unknown = null;
let chatSendResponse: unknown = null;
let chatInputResponse: unknown = null;
const fetchRequests: Array<{
  url: string;
  method: string;
  body?: unknown;
}> = [];

vi.mock('node:child_process', () => ({
  spawn: vi.fn((executable: string, args: readonly string[], options: { env?: NodeJS.ProcessEnv }) => {
    spawnCalls.push({ executable, args, options });
    const child = new EventEmitter() as MockChild;
    child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
    child.exitCode = null;
    child.signalCode = null;
    child.kill = vi.fn((signal: string) => {
      child.signalCode = signal;
      setImmediate(() => child.emit('exit', null, signal));
      return true;
    });
    spawnedChildren.push(child);
    const reportIndex = args.indexOf('--startup-report-file');
    const reportFile = reportIndex >= 0 ? args[reportIndex + 1] : '';
    if (reportFile) {
      setImmediate(async () => {
        await fs.mkdir(path.dirname(reportFile), { recursive: true });
        const attached = startupAttachedReports.length > 0 ? Boolean(startupAttachedReports.shift()) : startupAttached;
        await fs.writeFile(reportFile, JSON.stringify(startupMode === 'blocked'
          ? { status: 'blocked', code: 'flower_host_locked', message: 'Flower Host is already running.' }
          : { status: 'ready', host_id: 'host', base_url: 'http://127.0.0.1:12345', token: 'host-token', pid: startupPID, attached }));
      });
    }
    return child;
  }),
}));

vi.mock('./flowerHostSecretResolver', () => ({
  startFlowerHostSecretResolver: vi.fn(async () => ({
    baseURL: 'http://127.0.0.1:34567',
    token: 'resolver-token',
    close: async () => {
      secretResolverClosed = true;
    },
  })),
}));

beforeEach(() => {
  startupMode = 'ready';
  startupAttached = false;
  startupAttachedReports = [];
  startupPID = 4242;
  secretResolverClosed = false;
  fetchStatusOK = true;
  carrierState = 'ready';
  threadResponse = null;
  settingsResponse = null;
  chatSendResponse = null;
  chatInputResponse = null;
  spawnedChildren.splice(0);
  spawnCalls.splice(0);
  fetchRequests.splice(0);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    fetchRequests.push({
      url: String(input),
      method: String(init?.method ?? 'GET').toUpperCase(),
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
    });
    if (String(input).endsWith('/v1/status') && fetchStatusOK) {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          configured: true,
          ...(carrierState === 'missing' ? {} : {
            carrier: {
              state: carrierState,
              ...(carrierState === 'unreachable' ? { error: 'secret resolver connection refused' } : {}),
            },
          }),
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(input).includes('/v1/thread/') && threadResponse) {
      return new Response(JSON.stringify({ ok: true, data: threadResponse }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(input).endsWith('/v1/settings') && settingsResponse) {
      return new Response(JSON.stringify({ ok: true, data: settingsResponse }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(input).endsWith('/v1/chat/send') && chatSendResponse) {
      return new Response(JSON.stringify({ ok: true, data: chatSendResponse }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(input).endsWith('/v1/chat/input') && chatInputResponse) {
      return new Response(JSON.stringify({ ok: true, data: chatInputResponse }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      ok: false,
      error: {
        code: 'flower_host_unavailable',
        message: 'host unavailable',
      },
    }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }));
});

afterEach(async () => {
  const bridge = await import('./flowerHostBridge');
  await bridge.shutdownFlowerHostBridge();
  vi.unstubAllGlobals();
});

function bridgeArgs(root: string) {
  return {
    executablePath: '/tmp/redeven-test',
    paths: defaultDesktopFlowerHostPaths({ HOME: root }, () => '/ignored'),
    codec: createDesktopFlowerHostPlaintextSecretCodec(),
    tempRoot: root,
  };
}

function validActivityTimeline(): Record<string, unknown> {
  return {
    type: 'activity-timeline',
    schema_version: 1,
    run_id: 'run-1',
    turn_id: 'm-streaming',
    summary: {
      status: 'success',
      severity: 'quiet',
      needs_attention: false,
      total_items: 2,
      counts: { success: 2 },
    },
    items: [
      {
        item_id: 'tool-terminal',
        tool_id: 'tool-terminal',
        tool_name: 'terminal.exec',
        kind: 'tool',
        status: 'success',
        severity: 'quiet',
        needs_attention: false,
        requires_approval: false,
      },
      {
        item_id: 'tool-done',
        tool_id: 'tool-done',
        tool_name: 'task_complete',
        kind: 'control',
        status: 'success',
        severity: 'quiet',
        needs_attention: false,
        requires_approval: false,
      },
    ],
  };
}

function validThreadResponse(): Record<string, unknown> {
  return {
    thread_id: 'thread-streaming',
    title: 'Streaming',
    model_id: 'deepseek/deepseek-chat',
    working_dir: '/workspace/redeven',
    pinned_at_ms: 123,
    created_at_ms: 10,
    updated_at_ms: 90,
    status: 'running',
    source_label: 'this host',
    target_labels: [],
    read_status: {
      is_unread: false,
      snapshot: {
        activity_revision: 900,
        last_message_at_unix_ms: 90,
        activity_signature: 'status:running\u001factivity:900',
      },
      read_state: {
        last_seen_activity_revision: 900,
        last_read_message_at_unix_ms: 90,
        last_seen_activity_signature: 'status:running\u001factivity:900',
      },
    },
    messages: [
      {
        id: 'm-streaming',
        role: 'assistant',
        content: '',
        status: 'streaming',
        created_at_ms: 90,
        blocks: [
          { type: 'thinking', content: 'Checking context.' },
          { type: 'markdown', content: 'Partial answer' },
          validActivityTimeline(),
        ],
      },
    ],
    activity_timeline: [
      validActivityTimeline(),
    ],
    todo_snapshot: {
      version: 4,
      updated_at_ms: 95,
      summary: {
        total: 2,
        pending: 0,
        in_progress: 0,
        completed: 2,
        cancelled: 0,
      },
      todos: [
        { id: 'todo-1', content: 'Inspect context', status: 'completed' },
        { id: 'todo-2', content: 'Write answer', status: 'completed' },
      ],
    },
    error: {
      code: 'failed',
      message: 'provider rejected request',
    },
  };
}

function validInputRequestResponse(): Record<string, unknown> {
  return {
    prompt_id: 'prompt-ask-user',
    message_id: 'message-ask-user',
    tool_id: 'tool-ask-user',
    tool_name: 'ask_user',
    reason_code: 'needs_user_choice',
    required_from_user: ['target'],
    evidence_refs: ['m-streaming'],
    public_summary: 'Choose a target before Flower continues.',
    contains_secret: false,
    questions: [
      {
        id: 'target',
        header: 'Deployment target',
        question: 'Where should Flower deploy this change?',
        response_mode: 'select_or_write',
        choices_exhaustive: false,
        write_label: 'Other target',
        write_placeholder: 'Type another target',
        choices: [
          {
            choice_id: 'staging',
            label: 'Staging',
            description: 'Use the validation environment.',
            kind: 'select',
            actions: [
              {
                type: 'set_mode',
                mode: 'act',
              },
            ],
          },
        ],
      },
    ],
  };
}

function validSettingsResponse(): Record<string, unknown> {
  return {
    config: {
      schema_version: 1,
      enabled: false,
      current_model_id: '',
      execution_policy: {
        require_user_approval: true,
        block_dangerous_commands: true,
      },
      terminal_exec_policy: {
        default_timeout_ms: 120_000,
        max_timeout_ms: 600_000,
      },
      providers: [],
    },
    provider_secrets: [],
    target_cache: {
      version: 1,
      entries: [],
    },
  };
}

function validRouterDecision(): Record<string, unknown> {
  return {
    decision_id: 'decision-1',
    decision_revision: 1,
    route: 'blocked',
    reason_code: 'provider_not_configured',
    selected_handler: null,
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
    host_presence: {
      schema_version: 1,
      host_id: 'flower-host:test',
      host_kind: 'global',
      carrier_kind: 'desktop',
      display_name: 'Flower Host',
      state: 'online',
      endpoint: {
        visibility: 'loopback',
        base_url: 'http://127.0.0.1:12345',
      },
      capabilities: ['chat'],
      last_seen_at_unix_ms: 1_700_000_000_000,
    },
    allowed_actions: [],
    ui_chips: [],
    blocker: {
      code: 'provider_not_configured',
      message: 'Configure a provider before chatting.',
    },
    created_at_unix_ms: 1_700_000_000_000,
  };
}

describe('Flower Host bridge lifecycle', () => {
  it('passes secret resolver tokens through environment variables and stops the host on shutdown', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    try {
      const bridge = await import('./flowerHostBridge');

      const client = await bridge.ensureFlowerHostBridge(bridgeArgs(root));

      expect(client.baseURL).toBe('http://127.0.0.1:12345');
      expect(spawnCalls).toHaveLength(1);
      expect(spawnCalls[0]?.args).not.toContain('--auth-token');
      expect(spawnCalls[0]?.args).not.toContain('--secret-resolver-token');
      expect(spawnCalls[0]?.args).toContain('--secret-resolver-token-env');
      expect(spawnCalls[0]?.options.env?.REDEVEN_FLOWER_HOST_SECRET_RESOLVER_TOKEN).toBe('resolver-token');
      expect(JSON.stringify(spawnCalls[0])).not.toContain('desktop-access-token');

      await bridge.shutdownFlowerHostBridge();

      expect(spawnedChildren[0]?.kill).toHaveBeenCalledWith('SIGTERM');
      expect(secretResolverClosed).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('passes the carrier target broker into the loopback resolver without exposing provider tokens to the child', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    try {
      const bridge = await import('./flowerHostBridge');
      const openTargetSession = vi.fn(async () => ({
        target_id: 'provider:https%3A%2F%2Fredeven.test:env:env_a',
        provider_origin: 'https://redeven.test',
        env_public_id: 'env_a',
        grant_client: { channel_id: 'ch_target' },
        capabilities: {
          can_read: true,
          can_write: false,
          can_execute: false,
        },
        expires_at_unix_ms: 4_102_444_800_000,
      }));

      await bridge.ensureFlowerHostBridge({
        ...bridgeArgs(root),
        openTargetSession,
      });

      expect(startFlowerHostSecretResolver).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        openTargetSession,
      );
      expect(JSON.stringify(spawnCalls[0])).not.toContain('control_plane_' + 'access_token');
      expect(JSON.stringify(spawnCalls[0])).not.toContain('provider-access-token');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces blocked startup reports with their specific reason', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    startupMode = 'blocked';
    try {
      const bridge = await import('./flowerHostBridge');

      await expect(bridge.ensureFlowerHostBridge(bridgeArgs(root)))
        .rejects
        .toThrow('flower_host_locked: Flower Host is already running.');
      expect(secretResolverClosed).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('attaches to an existing host without terminating the owner process on shutdown', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    startupAttached = true;
    try {
      const bridge = await import('./flowerHostBridge');

      const client = await bridge.ensureFlowerHostBridge(bridgeArgs(root));

      expect(client.baseURL).toBe('http://127.0.0.1:12345');
      expect(spawnedChildren[0]?.kill).toHaveBeenCalledTimes(1);
      await bridge.shutdownFlowerHostBridge();

      expect(spawnedChildren[0]?.kill).toHaveBeenCalledTimes(1);
      expect(secretResolverClosed).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('restarts discovery when an attached host stops responding', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    startupAttached = true;
    try {
      const bridge = await import('./flowerHostBridge');

      await bridge.ensureFlowerHostBridge(bridgeArgs(root));
      fetchStatusOK = false;
      await expect(bridge.ensureFlowerHostBridge(bridgeArgs(root))).rejects.toThrow('host unavailable');

      expect(spawnCalls).toHaveLength(2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves message blocks, activity timelines, errors, and stable creation time from thread responses', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    threadResponse = validThreadResponse();
    try {
      const bridge = await import('./flowerHostBridge');

      const thread = await bridge.loadFlowerHostThreadViaBridge({
        ...bridgeArgs(root),
        threadID: 'thread-streaming',
      });

      expect(thread.created_at_ms).toBe(10);
      expect(thread.updated_at_ms).toBe(90);
      expect(thread.working_dir).toBe('/workspace/redeven');
      expect(thread.pinned_at_ms).toBe(123);
      expect(thread.read_status.is_unread).toBe(false);
      expect(thread.messages[0]).toMatchObject({
        status: 'streaming',
        blocks: [
          { type: 'thinking', content: 'Checking context.' },
          { type: 'markdown', content: 'Partial answer' },
          expect.objectContaining({
            type: 'activity-timeline',
            run_id: 'run-1',
            summary: expect.objectContaining({
              status: 'success',
              total_items: 2,
            }),
          }),
        ],
      });
      expect(thread.activity_timeline?.[0]).toMatchObject({
        type: 'activity-timeline',
        run_id: 'run-1',
        summary: {
          status: 'success',
          severity: 'quiet',
          needs_attention: false,
          total_items: 2,
          counts: { success: 2 },
        },
        items: [
          expect.objectContaining({
            item_id: 'tool-terminal',
            tool_name: 'terminal.exec',
            status: 'success',
          }),
          expect.objectContaining({
            item_id: 'tool-done',
            tool_name: 'task_complete',
            kind: 'control',
          }),
        ],
      });
      expect(thread.todo_snapshot).toEqual({
        version: 4,
        updated_at_ms: 95,
        summary: {
          total: 2,
          pending: 0,
          in_progress: 0,
          completed: 2,
          cancelled: 0,
        },
        todos: [
          { id: 'todo-1', content: 'Inspect context', status: 'completed' },
          { id: 'todo-2', content: 'Write answer', status: 'completed' },
        ],
      });
      expect(thread.error).toEqual({
        code: 'failed',
        message: 'provider rejected request',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects unsupported activity approval states from thread responses', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    const timeline = validActivityTimeline();
    const items = timeline.items as Array<Record<string, unknown>>;
    items[0] = {
      ...items[0],
      requires_approval: true,
      approval_state: 'required',
    };
    threadResponse = {
      ...validThreadResponse(),
      messages: [],
      activity_timeline: [timeline],
    };
    try {
      const bridge = await import('./flowerHostBridge');

      await expect(bridge.loadFlowerHostThreadViaBridge({
        ...bridgeArgs(root),
        threadID: 'thread-streaming',
      })).rejects.toThrow('thread.activity_timeline[0].items[0].approval_state has unsupported value "required"');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves structured input requests from thread responses', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    threadResponse = {
      ...validThreadResponse(),
      status: 'waiting_user',
      input_request: validInputRequestResponse(),
    };
    try {
      const bridge = await import('./flowerHostBridge');

      const thread = await bridge.loadFlowerHostThreadViaBridge({
        ...bridgeArgs(root),
        threadID: 'thread-streaming',
      });

      expect(thread.status).toBe('waiting_user');
      expect(thread.input_request).toEqual(validInputRequestResponse());
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('accepts canceled thread status from Flower Host responses', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    try {
      const bridge = await import('./flowerHostBridge');

      threadResponse = {
        ...validThreadResponse(),
        status: 'canceled',
      };
      await expect(bridge.loadFlowerHostThreadViaBridge({
        ...bridgeArgs(root),
        threadID: 'thread-streaming',
      })).resolves.toMatchObject({ status: 'canceled' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('patches thread title and pinned state and forks through Flower Host thread endpoints', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    threadResponse = { thread: validThreadResponse() };
    try {
      const bridge = await import('./flowerHostBridge');

      await expect(bridge.renameFlowerHostThreadViaBridge({
        ...bridgeArgs(root),
        request: { thread_id: 'thread-streaming', title: 'Renamed' },
      })).resolves.toMatchObject({ thread_id: 'thread-streaming' });
      await expect(bridge.setFlowerHostThreadPinnedViaBridge({
        ...bridgeArgs(root),
        request: { thread_id: 'thread-streaming', pinned: true },
      })).resolves.toMatchObject({ pinned_at_ms: 123 });
      await expect(bridge.forkFlowerHostThreadViaBridge({
        ...bridgeArgs(root),
        request: { thread_id: 'thread-streaming' },
      })).resolves.toMatchObject({ thread_id: 'thread-streaming' });

      expect(fetchRequests.some((request) => request.url.endsWith('/v1/thread/thread-streaming') && request.method === 'PATCH' && (request.body as { title?: string }).title === 'Renamed')).toBe(true);
      expect(fetchRequests.some((request) => request.url.endsWith('/v1/thread/thread-streaming') && request.method === 'PATCH' && (request.body as { pinned?: boolean }).pinned === true)).toBe(true);
      expect(fetchRequests.some((request) => request.url.endsWith('/v1/thread/thread-streaming/fork') && request.method === 'POST')).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('marks a Flower Host thread read through the read endpoint', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    threadResponse = { thread: validThreadResponse() };
    try {
      const bridge = await import('./flowerHostBridge');

      await expect(bridge.markFlowerHostThreadReadViaBridge({
        ...bridgeArgs(root),
        request: {
          thread_id: 'thread-streaming',
          snapshot: {
            activity_revision: 900,
            last_message_at_unix_ms: 90,
            activity_signature: 'status:running\u001factivity:900',
          },
        },
      })).resolves.toMatchObject({
        thread_id: 'thread-streaming',
        read_status: { is_unread: false },
      });

      expect(fetchRequests.some((request) => request.url.endsWith('/v1/thread/thread-streaming/read') && request.method === 'POST' && (request.body as { snapshot?: unknown }).snapshot)).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('posts structured input answers and normalizes the returned thread', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    chatInputResponse = {
      thread: {
        ...validThreadResponse(),
        status: 'running',
      },
    };
    const request = {
      thread_id: 'thread-streaming',
      prompt_id: 'prompt-ask-user',
      answers: {
        target: { choice_id: 'staging' },
        note: { text: 'Ship after validation.' },
      },
    };
    try {
      const bridge = await import('./flowerHostBridge');

      const thread = await bridge.submitFlowerHostInputViaBridge({
        ...bridgeArgs(root),
        request,
      });

      expect(thread.thread_id).toBe('thread-streaming');
      const outbound = fetchRequests.find((item) => item.url.endsWith('/v1/chat/input'));
      expect(outbound).toEqual({
        url: 'http://127.0.0.1:12345/v1/chat/input',
        method: 'POST',
        body: request,
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects malformed thread responses instead of defaulting missing fields', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    try {
      const bridge = await import('./flowerHostBridge');
      for (const item of [
        {
          name: 'missing status',
          thread: (() => {
            const thread = validThreadResponse();
            delete thread.status;
            return thread;
          })(),
          message: 'thread.status',
        },
        {
          name: 'missing read status',
          thread: (() => {
            const thread = validThreadResponse();
            delete thread.read_status;
            return thread;
          })(),
          message: 'thread.read_status',
        },
        {
          name: 'missing working directory',
          thread: (() => {
            const thread = validThreadResponse();
            delete thread.working_dir;
            return thread;
          })(),
          message: 'thread.working_dir',
        },
        {
          name: 'missing source label',
          thread: (() => {
            const thread = validThreadResponse();
            delete thread.source_label;
            return thread;
          })(),
          message: 'thread.source_label',
        },
        {
          name: 'missing target labels',
          thread: (() => {
            const thread = validThreadResponse();
            delete thread.target_labels;
            return thread;
          })(),
          message: 'thread.target_labels',
        },
        {
          name: 'invalid home host kind',
          thread: {
            ...validThreadResponse(),
            home_host_kind: 'desktop',
          },
          message: 'thread.home_host_kind',
        },
        {
          name: 'malformed input request',
          thread: {
            ...validThreadResponse(),
            input_request: {
              ...validInputRequestResponse(),
              questions: [],
            },
          },
          message: 'thread.input_request.questions',
        },
        {
          name: 'missing message status',
          thread: (() => {
            const thread = validThreadResponse();
            delete (thread.messages as Array<Record<string, unknown>>)[0].status;
            return thread;
          })(),
          message: 'thread.messages[0].status',
        },
        {
          name: 'missing input request tool name',
          thread: {
            ...validThreadResponse(),
            input_request: (() => {
              const request = validInputRequestResponse();
              delete request.tool_name;
              return request;
            })(),
          },
          message: 'thread.input_request.tool_name',
        },
        {
          name: 'missing input request response mode',
          thread: {
            ...validThreadResponse(),
            input_request: (() => {
              const request = validInputRequestResponse();
              delete (request.questions as Array<Record<string, unknown>>)[0].response_mode;
              return request;
            })(),
          },
          message: 'thread.input_request.questions[0].response_mode',
        },
      ]) {
        threadResponse = item.thread;
        await expect(bridge.loadFlowerHostThreadViaBridge({
          ...bridgeArgs(root),
          threadID: 'thread-streaming',
        }), item.name).rejects.toThrow(item.message);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects chat input responses without a returned thread', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    chatInputResponse = {};
    try {
      const bridge = await import('./flowerHostBridge');

      await expect(bridge.submitFlowerHostInputViaBridge({
        ...bridgeArgs(root),
        request: {
          thread_id: 'thread-streaming',
          prompt_id: 'prompt-ask-user',
          answers: {
            target: { choice_id: 'staging' },
          },
        },
      })).rejects.toThrow('chat_input.thread');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects settings responses without an explicit target cache contract', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    const settings = validSettingsResponse();
    delete settings.target_cache;
    settingsResponse = settings;
    try {
      const bridge = await import('./flowerHostBridge');

      await expect(bridge.loadFlowerHostSettingsViaBridge(bridgeArgs(root)))
        .rejects
        .toThrow('settings.target_cache');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves structured chat creation failures without inventing default errors', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    chatSendResponse = {
      create_failure: {
        error: {
          code: 'provider_not_configured',
          message: 'Configure a provider before chatting.',
        },
        fresh_decision: validRouterDecision(),
      },
    };
    try {
      const bridge = await import('./flowerHostBridge');

      const result = await bridge.sendFlowerHostChatResultViaBridge({
        ...bridgeArgs(root),
        request: {
          thread_id: '',
          prompt: 'hello',
        },
      });

      expect('create_failure' in result).toBe(true);
      if (!('create_failure' in result)) {
        throw new Error('expected create_failure branch');
      }
      expect(result.create_failure).toEqual({
        error: {
          code: 'provider_not_configured',
          message: 'Configure a provider before chatting.',
        },
        fresh_decision: validRouterDecision(),
      });
      expect('thread' in result).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('preserves successful chat send threads through the response union', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    chatSendResponse = {
      thread: validThreadResponse(),
    };
    try {
      const bridge = await import('./flowerHostBridge');

      const result = await bridge.sendFlowerHostChatResultViaBridge({
        ...bridgeArgs(root),
        request: {
          thread_id: 'thread-streaming',
          prompt: 'continue',
        },
      });

      expect('thread' in result).toBe(true);
      if (!('thread' in result)) {
        throw new Error('expected thread branch');
      }
      expect(result.thread.thread_id).toBe('thread-streaming');
      expect('create_failure' in result).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects malformed chat creation failures instead of defaulting error payloads', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    try {
      const bridge = await import('./flowerHostBridge');
      for (const item of [
        {
          name: 'missing error code',
          createFailure: {
            error: {
              message: 'Configure a provider before chatting.',
            },
          },
          message: 'create_failure.error.code',
        },
        {
          name: 'missing error message',
          createFailure: {
            error: {
              code: 'provider_not_configured',
            },
          },
          message: 'create_failure.error.message',
        },
        {
          name: 'malformed fresh decision',
          createFailure: {
            error: {
              code: 'provider_not_configured',
              message: 'Configure a provider before chatting.',
            },
            fresh_decision: {
              ...validRouterDecision(),
              route: 'fallback',
            },
          },
          message: 'create_failure.fresh_decision.route',
        },
        {
          name: 'missing fresh decision unavailable handlers',
          createFailure: {
            error: {
              code: 'provider_not_configured',
              message: 'Configure a provider before chatting.',
            },
            fresh_decision: (() => {
              const decision = validRouterDecision();
              delete decision.unavailable_handlers;
              return decision;
            })(),
          },
          message: 'create_failure.fresh_decision.unavailable_handlers',
        },
      ]) {
        chatSendResponse = {
          create_failure: item.createFailure,
        };
        await expect(bridge.sendFlowerHostChatResultViaBridge({
          ...bridgeArgs(root),
          request: {
            thread_id: '',
            prompt: 'hello',
          },
        }), item.name).rejects.toThrow(item.message);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('rejects chat send responses that do not satisfy the thread/create_failure union', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'redeven-flower-bridge-test-'));
    try {
      const bridge = await import('./flowerHostBridge');
      for (const item of [
        {
          name: 'missing both branches',
          response: {},
        },
        {
          name: 'conflicting branches',
          response: {
            thread: validThreadResponse(),
            create_failure: {
              error: {
                code: 'provider_not_configured',
                message: 'Configure a provider before chatting.',
              },
            },
          },
        },
      ]) {
        chatSendResponse = item.response;
        await expect(bridge.sendFlowerHostChatResultViaBridge({
          ...bridgeArgs(root),
          request: {
            thread_id: '',
            prompt: 'hello',
          },
        }), item.name).rejects.toThrow('chat_send');
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
