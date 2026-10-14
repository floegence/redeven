import { describe, expect, it } from 'vitest';

import { parseAskFlowerContextActionEnvelope } from './contextActionWire';

const composerAction = (context: readonly unknown[]) => ({
  schema_version: 2,
  action_id: 'assistant.ask.flower',
  provider: 'flower',
  target: { target_id: 'current', locality: 'auto' },
  source: { surface: 'flower_composer' },
  context,
  presentation: { label: 'Ask Flower', priority: 100 },
});

const terminalAction = (item: Record<string, unknown>) => ({
  ...composerAction([item]),
  source: { surface: 'terminal' },
});

describe('Thread reference snapshots', () => {
  const thread = { runtime_id: 'env:local-environment', thread_id: 'thread-source', title: 'Review 中文 code', status: 'idle', working_dir: '/workspace', created_at_ms: 1, updated_at_ms: 2, captured_at_ms: 3 };
  it('accepts exactly the frozen basic fields only from the composer', () => {
    const item = { kind: 'thread_reference', thread };
    expect(parseAskFlowerContextActionEnvelope(composerAction([item]))?.context).toEqual([item]);
    expect(parseAskFlowerContextActionEnvelope({ ...composerAction([item]), source: { surface: 'file_browser' } })).toBeNull();
  });
  it.each([
    { ...thread, preview: 'Private context' }, { ...thread, captured_at_ms: 0 },
    { ...thread, created_at_ms: Number.MAX_SAFE_INTEGER + 1 }, { ...thread, runtime_id: ' env:test' },
    { ...thread, thread_id: '../forged' }, { ...thread, title: 'Forged\nmetadata' }, { ...thread, title: 'Nul\0title' },
  ])('rejects forged snapshot %j', snapshot => {
    expect(parseAskFlowerContextActionEnvelope(composerAction([{ kind: 'thread_reference', thread: snapshot }]))).toBeNull();
  });
  it('rejects missing fields and parallel path authority', () => {
    const { title: _title, ...missing } = thread;
    expect(parseAskFlowerContextActionEnvelope(composerAction([{ kind: 'thread_reference', thread: missing }]))).toBeNull();
    expect(parseAskFlowerContextActionEnvelope(composerAction([{ kind: 'thread_reference', thread, path: '/forged' }]))).toBeNull();
  });
});

describe('Flower composer context action wire contract', () => {
  it.each([
    ['file', { kind: 'file_path', path: '/workspace/main.ts', is_directory: false }],
    ['directory', { kind: 'file_path', path: '/workspace/src', is_directory: true }],
  ])('accepts a canonical %s path', (_name, item) => {
    expect(parseAskFlowerContextActionEnvelope(composerAction([item]))).toMatchObject({
      source: { surface: 'flower_composer' },
      context: [item],
    });
  });

  it.each([
    ['terminal', { kind: 'terminal_selection', working_dir: '/workspace', selection: '', selection_chars: 0 }],
    ['process', { kind: 'process_snapshot', pid: 42, name: 'worker', username: 'demo', cpu_percent: 0, memory_bytes: 0, platform: 'linux', captured_at_ms: 1 }],
  ])('rejects %s context', (_name, item) => {
    expect(parseAskFlowerContextActionEnvelope(composerAction([item]))).toBeNull();
  });

  it('combines a page snapshot with file references and rejects forged snapshot fields', () => {
    const page = { kind: 'text_snapshot', title: 'Monitor', content: 'Page: Monitor' };
    const file = { kind: 'file_path', path: '/workspace/main.ts', is_directory: false };
    expect(parseAskFlowerContextActionEnvelope(composerAction([page, file]))?.context).toEqual([page, file]);
    expect(parseAskFlowerContextActionEnvelope(composerAction([{ ...page, path: '/forged' }]))).toBeNull();
    expect(parseAskFlowerContextActionEnvelope(composerAction([{ ...page, detail: 'hidden metadata' }]))).toBeNull();
  });

  it('rejects unknown envelope and item fields', () => {
    expect(parseAskFlowerContextActionEnvelope({
      ...composerAction([{ kind: 'file_path', path: '/workspace/main.ts', is_directory: false }]),
      unknown: true,
    })).toBeNull();
    expect(parseAskFlowerContextActionEnvelope(composerAction([{
      kind: 'file_path', path: '/workspace/main.ts', is_directory: false, content: 'hidden body',
    }]))).toBeNull();
    expect(parseAskFlowerContextActionEnvelope(composerAction([{
      kind: 'file_path', path: '/workspace/main.ts', is_directory: false, root_label: 'forged label',
    }]))).toBeNull();
  });
});

describe('Terminal Ask Flower context action wire contract', () => {
  it('accepts terminal context without a local working directory', () => {
    expect(parseAskFlowerContextActionEnvelope(terminalAction({
      kind: 'terminal_selection',
      selection: 'npm test',
      selection_chars: 8,
    }))).toMatchObject({
      context: [{ kind: 'terminal_selection', selection: 'npm test', selection_chars: 8 }],
    });
  });

  it.each(['', null])('rejects an explicitly empty terminal working directory %j', (workingDirectory) => {
    expect(parseAskFlowerContextActionEnvelope(terminalAction({
      kind: 'terminal_selection',
      working_dir: workingDirectory,
      selection: 'npm test',
      selection_chars: 8,
    }))).toBeNull();
  });

  it.each(['', '   ', '/workspace\nforged'])('rejects explicit invalid suggested working directory %j', (suggestedWorkingDirectory) => {
    expect(parseAskFlowerContextActionEnvelope({
      ...terminalAction({
        kind: 'terminal_selection',
        selection: 'npm test',
        selection_chars: 8,
      }),
      suggested_working_dir_abs: suggestedWorkingDirectory,
    })).toBeNull();
  });

  it('rejects unknown terminal envelope and item fields', () => {
    expect(parseAskFlowerContextActionEnvelope({
      ...terminalAction({
        kind: 'terminal_selection',
        selection: 'npm test',
        selection_chars: 8,
      }),
      unknown: true,
    })).toBeNull();
    expect(parseAskFlowerContextActionEnvelope(terminalAction({
      kind: 'terminal_selection',
      selection: 'npm test',
      selection_chars: 8,
      content: 'forged context',
    }))).toBeNull();
  });
});

describe('Tessiven composer context', () => {
  const selection = { kind: 'tessiven_selection', canvas_id: 'commerce', version_id: 2, object_refs: ['orders'] };
  const action = (file: unknown) => ({ ...composerAction([selection, file]), source: { surface: 'tessiven' } });
  it('combines immutable canvas context with canonical file references', () => {
    const file = { kind: 'file_path', path: '/workspace/orders.ts', is_directory: false };
    expect(parseAskFlowerContextActionEnvelope(action(file))?.context).toEqual([selection, file]);
  });
  it('rejects forged metadata in embedded file references', () => {
    expect(parseAskFlowerContextActionEnvelope(action({ kind: 'file_path', path: '/workspace/orders.ts', is_directory: false, root_label: 'forged' }))).toBeNull();
  });
});
