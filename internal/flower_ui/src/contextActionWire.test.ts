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
