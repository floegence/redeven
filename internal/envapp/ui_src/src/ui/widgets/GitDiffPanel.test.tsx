// @vitest-environment jsdom
import { LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { RpcError } from '@floegence/floe-webapp-protocol';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitDiffFileContent, GitGetDiffContentResponse } from '../protocol/redeven_v1';
import { GitDiffPanel, type GitDiffPanelProps } from './GitDiffPanel';

const getDiffContent = vi.hoisted(() => vi.fn());
const connection = vi.hoisted(() => ({ transport: () => null as object | null }));
vi.mock('@floegence/floe-webapp-protocol', async () => ({
  ...await vi.importActual<typeof import('@floegence/floe-webapp-protocol')>('@floegence/floe-webapp-protocol'),
  useProtocol: () => ({ rpcTransport: () => connection.transport() }),
}));
vi.mock('../protocol/redeven_v1', async () => ({
  ...await vi.importActual<typeof import('../protocol/redeven_v1')>('../protocol/redeven_v1'),
  useRedevenRpc: () => ({ git: { getDiffContent } }),
}));
beforeEach(() => {
  const transport = {};
  connection.transport = () => transport;
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })));
});
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
let disposePanel: (() => void) | undefined;
afterEach(() => { disposePanel?.(); disposePanel = undefined; document.body.replaceChildren(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function mountPanel(props: Partial<GitDiffPanelProps> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  disposePanel = render(() => <LayoutProvider><NotificationProvider>
    <GitDiffPanel open item={{ path: 'restored.ts' }} source={{ kind: 'workspace', repoRootPath: '/repo', workspaceSection: 'unstaged' }} emptyMessage="No changes" {...props} />
  </NotificationProvider></LayoutProvider>, host);
  return host;
}

function click(host: HTMLElement, name: string) {
  const button = Array.from(host.querySelectorAll('button')).find((button) => (button.getAttribute('aria-label') ?? button.textContent)?.toLowerCase() === name.toLowerCase());
  expect(button).toBeDefined();
  button!.click();
}

function response(text: string, mode = 'preview'): GitGetDiffContentResponse {
  return { repoRootPath: '/repo', mode, file: { path: 'restored.ts', changeType: 'modified', patchText: `@@ -1 +1 @@\n-old\n+${text}` } };
}

function deferRequests() {
  const requests: Array<{ resolve: (value: GitGetDiffContentResponse) => void; reject: (error: Error) => void }> = [];
  getDiffContent.mockImplementation(() => new Promise((resolve, reject) => requests.push({ resolve, reject })));
  return requests;
}

describe('GitDiffPanel request ownership', () => {
  it('waits for a restored canvas connection and loads automatically once transport is ready', async () => {
    const [transport, setTransport] = createSignal<object | null>(null);
    connection.transport = transport;
    getDiffContent.mockResolvedValue({ file: { path: 'restored.ts', patchText: '@@ -1 +1 @@\n-old\n+connected' } });
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <LayoutProvider><NotificationProvider><GitDiffPanel open item={{ path: 'restored.ts' }} source={{ kind: 'workspace', repoRootPath: '/repo', workspaceSection: 'unstaged' }} emptyMessage="No changes" /></NotificationProvider></LayoutProvider>, host);
    try {
      await flush();
      expect(getDiffContent).not.toHaveBeenCalled();
      expect(host.textContent).toContain('Waiting for connection');
      setTransport({});
      await flush();
      expect(getDiffContent).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain('connected');
    } finally { dispose(); }
  });

  it.each(['preview', 'full'])('settles an absent %s result without stale patch content or a loading loop', async (mode) => {
    getDiffContent.mockImplementation(async (request) => request.mode === mode
      ? { repoRootPath: '/repo', mode }
      : { repoRootPath: '/repo', mode: 'preview', file: { path: 'gone.ts', patchText: '@@ -1 +1 @@\n-old\n+obsoleteValue' } });
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <LayoutProvider><NotificationProvider><GitDiffPanel open item={{ path: 'gone.ts' }} source={{ kind: 'workspace', repoRootPath: '/repo', workspaceSection: 'unstaged' }} emptyMessage="No changes remain" /></NotificationProvider></LayoutProvider>, host);
    try {
      await flush();
      if (mode === 'full') {
        Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.toLowerCase() === 'full context')!.click();
        await flush();
      }
      expect(host.querySelector('[data-git-diff-empty]'), host.textContent ?? '').not.toBeNull();
      expect(host.textContent).not.toContain('obsoleteValue');
      expect(host.textContent).not.toContain('Loading');
      expect(getDiffContent).toHaveBeenCalledTimes(mode === 'full' ? 2 : 1);
    } finally { dispose(); }
  });

  it('loads when mounted open, rejects late file results, and reloads refreshed summaries at the same path', async () => {
    const pending: Array<(value: GitGetDiffContentResponse) => void> = [];
    getDiffContent.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const [item, setItem] = createSignal<GitDiffFileContent>({ path: 'first.ts', changeType: 'modified' });
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => (
      <LayoutProvider><NotificationProvider>
        <GitDiffPanel open item={item()} source={{ kind: 'workspace', repoRootPath: '/repo', workspaceSection: 'unstaged' }} emptyMessage="Select a file" />
      </NotificationProvider></LayoutProvider>
    ), host);
    const result = (path: string, text: string): GitGetDiffContentResponse => ({ repoRootPath: '/repo', mode: 'preview', file: { path, changeType: 'modified', patchText: `@@ -1 +1 @@\n-old\n+${text}` } });
    try {
      await flush();
      expect(getDiffContent).toHaveBeenCalledTimes(1);
      setItem({ path: 'second.ts', changeType: 'modified' });
      await flush();
      expect(getDiffContent).toHaveBeenCalledTimes(2);
      pending[1](result('second.ts', 'currentValue'));
      await flush();
      pending[0](result('first.ts', 'obsoleteValue'));
      await flush();
      expect(host.textContent).toContain('currentValue');
      expect(host.textContent).not.toContain('obsoleteValue');
      setItem({ path: 'second.ts', changeType: 'modified', additions: 2 });
      await flush();
      expect(getDiffContent).toHaveBeenCalledTimes(3);
      expect(host.textContent).not.toContain('currentValue');
      pending[2](result('second.ts', 'refreshedValue'));
      await flush();
      expect(host.textContent).toContain('refreshedValue');
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally { dispose(); }
  });

  it.each(['disconnect', 'replace'])('rejects late successes and failures after transport %s', async (transition) => {
    const [transport, setTransport] = createSignal<object | null>({});
    connection.transport = transport;
    const requests = deferRequests();
    const host = mountPanel();
    await flush();
    click(host, 'Full Context');
    await flush();
    expect(requests).toHaveLength(2);
    if (transition === 'disconnect') {
      setTransport(null);
      await flush();
      expect(requests).toHaveLength(2);
      expect(host.textContent).toContain('Waiting for connection');
      expect(host.querySelector('button[aria-label="Refresh diff"]')?.hasAttribute('disabled')).toBe(true);
    }
    setTransport({});
    await flush();
    expect(requests).toHaveLength(4);
    requests[2].resolve(response('currentPatch'));
    requests[3].resolve(response('currentFull', 'full'));
    await flush();
    requests[0].resolve(response('obsoletePatch'));
    requests[1].reject(new RpcError({ typeId: 1119, code: 404, message: 'old session failure' }));
    await flush();
    expect(host.textContent).toContain('currentFull');
    expect(host.textContent).not.toContain('obsoletePatch');
    expect(host.textContent).not.toContain('no longer available');
    click(host, 'Patch');
    await flush();
    expect(host.textContent).toContain('currentPatch');
    expect(requests).toHaveLength(4);
  });

  it('invalidates completed network content on disconnect and defers inactive full context on recovery', async () => {
    const [transport, setTransport] = createSignal<object | null>({});
    connection.transport = transport;
    getDiffContent.mockImplementation(async (request) => response('previousSession', request.mode));
    const host = mountPanel();
    await flush();
    click(host, 'Full Context');
    await flush();
    click(host, 'Patch');
    setTransport(null);
    await flush();
    expect(host.textContent).not.toContain('previousSession');
    expect(getDiffContent).toHaveBeenCalledTimes(2);
    getDiffContent.mockImplementation(async (request) => response('newSession', request.mode));
    setTransport({});
    await flush();
    expect(getDiffContent).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain('newSession');
    click(host, 'Full Context');
    await flush();
    expect(getDiffContent).toHaveBeenCalledTimes(4);
    expect(getDiffContent.mock.calls.map(([request]) => request.mode)).toEqual(['preview', 'full', 'preview', 'full']);
  });

  it('keeps a pending full request and its result across mode switches without duplication', async () => {
    const requests = deferRequests();
    const host = mountPanel();
    await flush();
    requests[0].resolve(response('previewValue'));
    await flush();
    click(host, 'Full Context');
    await flush();
    expect(host.textContent).toContain('previewValue');
    click(host, 'Patch');
    click(host, 'Full Context');
    await flush();
    expect(requests).toHaveLength(2);
    requests[1].resolve(response('fullValue', 'full'));
    await flush();
    expect(host.textContent).toContain('fullValue');
    click(host, 'Patch');
    click(host, 'Full Context');
    await flush();
    expect(requests).toHaveLength(2);
  });

  it.each([
    [404, 'The selected diff or its source is no longer available.'],
    [403, 'You do not have permission to read this diff.'],
    [500, 'Refresh the diff to try again.'],
    [-1, 'Refresh the diff to try again.'],
  ])('classifies RPC %s without exposing raw errors or retrying on mode switches', async (code, detail) => {
    getDiffContent.mockRejectedValue(new RpcError({ typeId: 1119, code: code as number, message: 'raw private git stderr' }));
    const host = mountPanel();
    await flush();
    expect(host.textContent).toContain(detail);
    expect(host.textContent).not.toContain('raw private');
    if (code !== 404) expect(host.textContent).not.toContain('no longer available');
    click(host, 'Full Context');
    await flush();
    click(host, 'Patch');
    click(host, 'Full Context');
    await flush();
    expect(getDiffContent).toHaveBeenCalledTimes(2);
    getDiffContent.mockImplementation(async (request) => response('recovered', request.mode));
    click(host, 'Refresh diff');
    await flush();
    expect(getDiffContent).toHaveBeenCalledTimes(4);
    expect(host.textContent).toContain('recovered');
  });

  it('keeps explicit seeded snapshots available without a connection and never revives them after a failed refresh', async () => {
    const [transport, setTransport] = createSignal<object | null>(null);
    connection.transport = transport;
    const host = mountPanel({ item: response('seededSnapshot').file! });
    await flush();
    expect(host.textContent).toContain('seededSnapshot');
    expect(getDiffContent).not.toHaveBeenCalled();
    setTransport({});
    await flush();
    expect(getDiffContent).not.toHaveBeenCalled();
    getDiffContent.mockRejectedValue(new RpcError({ typeId: 1119, code: 404 }));
    click(host, 'Refresh diff');
    await flush();
    expect(host.textContent).not.toContain('seededSnapshot');
    expect(host.textContent).toContain('no longer available');
    setTransport({});
    await flush();
    expect(getDiffContent).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain('seededSnapshot');
  });

  it('invalidates closed and disposed requests and reloads on reopen without resetting the selected mode', async () => {
    const [open, setOpen] = createSignal(true);
    const requests = deferRequests();
    const host = mountPanel({ get open() { return open(); } });
    await flush();
    click(host, 'Full Context');
    await flush();
    setOpen(false);
    await flush();
    requests[0].resolve(response('closedPatch'));
    requests[1].reject(new Error('closed request'));
    await flush();
    setOpen(true);
    await flush();
    expect(requests).toHaveLength(4);
    expect(host.textContent).not.toContain('closedPatch');
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Full Context');
    disposePanel!(); disposePanel = undefined;
    requests[2].resolve(response('disposedPatch'));
    requests[3].reject(new Error('disposed request'));
    await flush();
    expect(host.textContent).toBe('');
  });
});
