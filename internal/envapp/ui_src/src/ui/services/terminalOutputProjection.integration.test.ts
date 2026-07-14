import { describe, expect, it, vi } from 'vitest';
import { createPagedTerminalOutputCoordinator } from '../../../node_modules/@floegence/floeterm-terminal-web/dist/core/PagedTerminalOutputCoordinator.js';
import type {
  PagedTerminalHistoryPage,
} from '../../../node_modules/@floegence/floeterm-terminal-web/dist/core/PagedTerminalOutputCoordinator.js';
import type {
  TerminalOutputPipelineChunk,
} from '../../../node_modules/@floegence/floeterm-terminal-web/dist/core/TerminalOutputPipeline.js';

import {
  createTerminalOutputProjection,
  tagTerminalOutputChunk,
} from './terminalOutputProjection';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function chunk(sequence: number, data: string, source: 'history' | 'live' = 'history') {
  return tagTerminalOutputChunk({ sequence, data: encoder.encode(data) }, source);
}

function page(overrides: Partial<PagedTerminalHistoryPage> = {}): PagedTerminalHistoryPage {
  return {
    chunks: [],
    hasMore: false,
    coveredThroughSequence: 0,
    ...overrides,
  };
}

describe('terminal output projection with the published coordinator', () => {
  it('does not transform, write, or publish side effects from an obsolete history request', async () => {
    let resolveObsolete: ((value: PagedTerminalHistoryPage) => void) | undefined;
    const obsolete = new Promise<PagedTerminalHistoryPage>((resolve) => {
      resolveObsolete = resolve;
    });
    const shellEvents: string[] = [];
    const committedChunks: string[] = [];
    const writes: string[] = [];
    const transformedSequences: number[] = [];
    const projection = createTerminalOutputProjection({
      onChunkCommitted: (source, sequence) => committedChunks.push(`${source}:${sequence}`),
      onShellIntegrationEvent: (event) => {
        if (event.kind === 'cwd-update') shellEvents.push(event.workingDir);
      },
    });
    const transformChunk = vi.fn((item: TerminalOutputPipelineChunk) => {
      transformedSequences.push(item.sequence ?? 0);
      return projection.transformChunk(item);
    });
    const fetchPage = vi.fn()
      .mockReturnValueOnce(obsolete)
      .mockResolvedValueOnce(page({
        chunks: [chunk(2, '\x1b]633;P;Cwd=/current\u0007current')],
        coveredThroughSequence: 2,
      }));
    const coordinator = createPagedTerminalOutputCoordinator({
      fetchPage,
      transformChunk,
      write: (data) => writes.push(decoder.decode(data)),
      writeHistory: (data) => writes.push(decoder.decode(data)),
      clear: projection.reset,
    });

    const firstAttach = coordinator.attach(1);
    await vi.waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));
    await coordinator.attach(2);
    resolveObsolete?.(page({
      chunks: [chunk(1, '\x1b]633;P;Cwd=/obsolete\u0007obsolete')],
      coveredThroughSequence: 1,
    }));
    await firstAttach;

    expect(transformedSequences).toEqual([2]);
    expect(committedChunks).toEqual(['history:2']);
    expect(shellEvents).toEqual(['/current']);
    expect(writes).toEqual(['current']);
    coordinator.dispose();
  });

  it('rebases a new history generation without duplicating ordered projection side effects', async () => {
    const shellEvents: string[] = [];
    const visibleOutput: string[] = [];
    const writes: string[] = [];
    const transformedSequences: number[] = [];
    const projection = createTerminalOutputProjection({
      onShellIntegrationEvent: (event, source) => {
        if (event.kind === 'cwd-update') shellEvents.push(`${source}:${event.workingDir}`);
      },
      onVisibleOutput: (source, byteLength) => visibleOutput.push(`${source}:${byteLength}`),
    });
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page({
        coveredThroughSequence: 5,
        snapshotEndSequence: 5,
        historyGeneration: 1,
      }))
      .mockResolvedValueOnce(page({
        coveredThroughSequence: 0,
        snapshotEndSequence: 0,
        firstRetainedSequence: 0,
        historyGeneration: 2,
        historyReset: true,
      }))
      .mockResolvedValueOnce(page({
        chunks: [chunk(6, '\x1b]633;P;Cwd=/generation-two\u0007six')],
        coveredThroughSequence: 6,
        snapshotEndSequence: 6,
        firstRetainedSequence: 6,
        historyGeneration: 2,
      }));
    const coordinator = createPagedTerminalOutputCoordinator({
      fetchPage,
      transformChunk: (item) => {
        transformedSequences.push(item.sequence ?? 0);
        return projection.transformChunk(item);
      },
      write: (data) => writes.push(decoder.decode(data)),
      writeHistory: (data) => writes.push(decoder.decode(data)),
      clear: () => {
        writes.push('[clear]');
        projection.reset();
      },
      policy: { retryDelaysMs: [] },
    });

    await coordinator.attach(1);
    coordinator.pushLive(chunk(7, 'seven', 'live'));
    await vi.waitFor(() => expect(coordinator.getSnapshot().coveredThroughSequence).toBe(7));

    expect(transformedSequences).toEqual([6, 7]);
    expect(shellEvents).toEqual(['history:/generation-two']);
    expect(visibleOutput).toEqual(['history:3', 'live:5']);
    expect(writes.join('')).toBe('[clear]sixseven');
    coordinator.dispose();
  });

  it('rebases advancing retention and projects each accepted sequence once', async () => {
    const writes: string[] = [];
    const transformedSequences: number[] = [];
    const projection = createTerminalOutputProjection({});
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page({
        chunks: [chunk(1, 'one')],
        hasMore: true,
        nextCursor: 'next',
        coveredThroughSequence: 2,
        snapshotEndSequence: 6,
        firstRetainedSequence: 1,
        historyGeneration: 1,
      }))
      .mockResolvedValueOnce(page({
        coveredThroughSequence: 2,
        snapshotEndSequence: 6,
        firstRetainedSequence: 6,
        historyGeneration: 1,
        historyTruncated: true,
      }))
      .mockResolvedValueOnce(page({
        chunks: [chunk(6, 'six')],
        coveredThroughSequence: 6,
        snapshotEndSequence: 6,
        firstRetainedSequence: 6,
        historyGeneration: 1,
      }));
    const coordinator = createPagedTerminalOutputCoordinator({
      fetchPage,
      transformChunk: (item) => {
        transformedSequences.push(item.sequence ?? 0);
        return projection.transformChunk(item);
      },
      write: (data) => writes.push(decoder.decode(data)),
      writeHistory: (data) => writes.push(decoder.decode(data)),
      clear: () => {
        writes.push('[clear]');
        projection.reset();
      },
      policy: { retryDelaysMs: [] },
    });

    await coordinator.attach(1);

    expect(transformedSequences).toEqual([6]);
    expect(writes.join('')).toBe('[clear]six');
    expect(coordinator.getSnapshot().coveredThroughSequence).toBe(6);
    coordinator.dispose();
  });

  it('fences the writer during pause and drains retained output once after resume', async () => {
    let completeWriter: (() => void) | undefined;
    const writerCompletion = new Promise<void>((resolve) => {
      completeWriter = resolve;
    });
    const writes: string[] = [];
    const transformedSequences: number[] = [];
    const projection = createTerminalOutputProjection({});
    const coordinator = createPagedTerminalOutputCoordinator({
      fetchPage: async () => page({ coveredThroughSequence: 0 }),
      transformChunk: (item) => {
        transformedSequences.push(item.sequence ?? 0);
        return projection.transformChunk(item);
      },
      write: async (data) => {
        writes.push(decoder.decode(data));
        if (writes.length === 1) await writerCompletion;
      },
      clear: projection.reset,
    });
    await coordinator.attach(0);
    coordinator.pushLive(chunk(1, 'one', 'live'));
    await vi.waitFor(() => expect(writes).toEqual(['one']));

    let paused = false;
    const pause = coordinator.pause().then((snapshot) => {
      paused = true;
      return snapshot;
    });
    coordinator.pushLive(chunk(2, 'two', 'live'));
    await Promise.resolve();
    expect(paused).toBe(false);
    expect(transformedSequences).toEqual([1]);

    completeWriter?.();
    await expect(pause).resolves.toMatchObject({ active: false, coveredThroughSequence: 1 });
    coordinator.setActive(true);
    await vi.waitFor(() => expect(writes).toEqual(['one', 'two']));

    expect(transformedSequences).toEqual([1, 2]);
    coordinator.dispose();
  });

  it('stops multi-batch history recovery after the committed writer when paused', async () => {
    let completeFirstWrite: (() => void) | undefined;
    const firstWriteCompletion = new Promise<void>((resolve) => {
      completeFirstWrite = resolve;
    });
    const writes: string[] = [];
    const transformedSequences: number[] = [];
    const projection = createTerminalOutputProjection({});
    const coordinator = createPagedTerminalOutputCoordinator({
      fetchPage: async () => page({
        chunks: [chunk(1, 'one'), chunk(2, 'two')],
        coveredThroughSequence: 2,
      }),
      transformChunk: (item) => {
        transformedSequences.push(item.sequence ?? 0);
        return projection.transformChunk(item);
      },
      write: () => {},
      writeHistory: async (data) => {
        writes.push(decoder.decode(data));
        if (writes.length === 1) await firstWriteCompletion;
      },
      clear: projection.reset,
      policy: { maxWriteBatchBytes: 3 },
    });

    void coordinator.attach(1);
    await vi.waitFor(() => expect(writes).toEqual(['one']));
    const pause = coordinator.pause();
    await Promise.resolve();
    expect(coordinator.getSnapshot().active).toBe(false);

    completeFirstWrite?.();
    await expect(pause).resolves.toMatchObject({
      active: false,
      coveredThroughSequence: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(transformedSequences).toEqual([1]);
    expect(writes).toEqual(['one']);

    coordinator.setActive(true);
    await vi.waitFor(() => expect(writes).toEqual(['one', 'two']));
    expect(transformedSequences).toEqual([1, 2]);
    expect(coordinator.getSnapshot().coveredThroughSequence).toBe(2);
    coordinator.dispose();
  });
});
