// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LARGE_DIFF_NEW_CODE, LARGE_DIFF_OLD_CODE } from '../__fixtures__/largeDiff';
import type { CodeDiffRenderModel } from '../types';
import { CodeDiffBlock } from './CodeDiffBlock';

const deferredPaintCallbacks = vi.hoisted(() => [] as Array<() => void>);
const renderCodeDiffModelSyncMock = vi.hoisted(() => vi.fn());
const renderCodeDiffModelMock = vi.hoisted(() => vi.fn());
const hasDiffWorkerSupportMock = vi.hoisted(() => vi.fn(() => true));

const SMALL_DIFF_MODEL: CodeDiffRenderModel = {
  unifiedLines: [
    { type: 'removed', sign: '-', lineNumber: 1, content: 'const before = 1;' },
    { type: 'added', sign: '+', lineNumber: 1, content: 'const after = 2;' },
  ],
  split: {
    left: [
      { type: 'removed', lineNumber: 1, content: 'const before = 1;' },
      { type: 'empty', lineNumber: null, content: '' },
    ],
    right: [
      { type: 'empty', lineNumber: null, content: '' },
      { type: 'added', lineNumber: 1, content: 'const after = 2;' },
    ],
  },
  stats: {
    added: 1,
    removed: 1,
  },
};

const LARGE_DIFF_MODEL: CodeDiffRenderModel = {
  unifiedLines: Array.from({ length: 24 }, (_, index) => ({
    type: index % 2 === 0 ? 'context' : 'added',
    sign: index % 2 === 0 ? ' ' : '+',
    lineNumber: index + 1,
    content: `line ${index + 1}`,
  })),
  split: {
    left: Array.from({ length: 24 }, (_, index) => ({
      type: index % 2 === 0 ? 'context' : 'empty',
      lineNumber: index % 2 === 0 ? index + 1 : null,
      content: index % 2 === 0 ? `before ${index + 1}` : '',
    })),
    right: Array.from({ length: 24 }, (_, index) => ({
      type: index % 2 === 0 ? 'context' : 'added',
      lineNumber: index + 1,
      content: `after ${index + 1}`,
    })),
  },
  stats: {
    added: 12,
    removed: 0,
  },
};

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  deferAfterPaint: (fn: () => void) => {
    deferredPaintCallbacks.push(fn);
  },
}));

vi.mock('../workers/diffWorkerClient', () => ({
  hasDiffWorkerSupport: () => hasDiffWorkerSupportMock(),
  renderCodeDiffModelSync: (...args: unknown[]) => renderCodeDiffModelSyncMock(...args),
  renderCodeDiffModel: (...args: unknown[]) => renderCodeDiffModelMock(...args),
}));

vi.mock('../hooks/useVirtualWindow', () => ({
  useVirtualWindow: () => ({
    scrollRef: vi.fn(),
    onScroll: vi.fn(),
    range: () => ({ start: 0, end: 4 }),
    paddingTop: () => 0,
    paddingBottom: () => 96,
    totalSize: () => 192,
  }),
}));

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushAfterPaint(): Promise<void> {
  while (deferredPaintCallbacks.length > 0) {
    const callback = deferredPaintCallbacks.shift();
    callback?.();
    await flushAsync();
  }
}

afterEach(() => {
  document.body.innerHTML = '';
  deferredPaintCallbacks.length = 0;
  renderCodeDiffModelSyncMock.mockReset();
  renderCodeDiffModelMock.mockReset();
  hasDiffWorkerSupportMock.mockReset();
  hasDiffWorkerSupportMock.mockReturnValue(true);
});

describe('CodeDiffBlock', () => {
  it('renders small diffs through the deferred main-thread path', async () => {
    renderCodeDiffModelSyncMock.mockReturnValue(SMALL_DIFF_MODEL);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <CodeDiffBlock
        language="typescript"
        oldCode="const before = 1;"
        newCode="const after = 2;"
        filename="demo.ts"
      />
    ), host);

    expect(renderCodeDiffModelSyncMock).not.toHaveBeenCalled();
    await flushAfterPaint();

    expect(renderCodeDiffModelSyncMock).toHaveBeenCalledWith('const before = 1;', 'const after = 2;');
    expect(renderCodeDiffModelMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain('demo.ts');
    expect(host.textContent).toContain('+1');
    expect(host.querySelectorAll('.chat-diff-line')).toHaveLength(2);
  });

  it('uses the worker path and bounded viewport for large diffs', async () => {
    renderCodeDiffModelMock.mockResolvedValue(LARGE_DIFF_MODEL);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <CodeDiffBlock
        language="typescript"
        oldCode={LARGE_DIFF_OLD_CODE}
        newCode={LARGE_DIFF_NEW_CODE}
        filename="generated.ts"
      />
    ), host);

    expect(renderCodeDiffModelMock).not.toHaveBeenCalled();
    await flushAfterPaint();

    expect(renderCodeDiffModelMock).toHaveBeenCalledWith(LARGE_DIFF_OLD_CODE, LARGE_DIFF_NEW_CODE);
    expect(renderCodeDiffModelSyncMock).not.toHaveBeenCalled();
    expect(host.querySelector('.chat-code-diff-viewport')).toBeTruthy();
    expect(host.querySelectorAll('.chat-diff-line')).toHaveLength(4);

    const splitButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent === 'Split');
    splitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsync();

    expect(host.querySelectorAll('.chat-code-diff-split-panel')).toHaveLength(2);
    expect(host.querySelectorAll('.chat-diff-line')).toHaveLength(8);
  });
});
