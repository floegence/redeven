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
    ['text', { kind: 'text_snapshot', title: 'Selection', content: 'body' }],
  ])('rejects %s context', (_name, item) => {
    expect(parseAskFlowerContextActionEnvelope(composerAction([item]))).toBeNull();
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
