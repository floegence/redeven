import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseAskFlowerContextActionEnvelope } from '../contextActionWire';
import { parseChatContextAction } from './flowerChatContextModel';

type WireFixture = Readonly<{
  name: string;
  expect_kind: string;
  expect_label: string;
  action: unknown;
}>;

const fixtures = JSON.parse(fs.readFileSync(
  new URL('../../../ai/testdata/context_action_wire_v2.json', import.meta.url),
  'utf8',
)) as WireFixture[];

const baseAction = {
  schema_version: 2,
  action_id: 'assistant.ask.flower',
  provider: 'flower',
  target: { target_id: 'current', locality: 'auto' },
  source: { surface: 'file_preview' },
  context: [{ kind: 'file_path', path: '/workspace/index.ts', is_directory: false }],
  presentation: { label: 'Ask Flower', priority: 100 },
};

describe('Flower chat linked context parser', () => {
  it.each(fixtures)('parses shared wire fixture $name', (fixture) => {
    const parsed = parseAskFlowerContextActionEnvelope(fixture.action, 'persisted-display');
    const display = parseChatContextAction(fixture.action);

    expect(parsed).not.toBeNull();
    expect(display?.chips).toHaveLength(1);
    expect(display?.chips[0]).toMatchObject({
      kind: fixture.expect_kind,
      label: fixture.expect_label,
    });
    expect(parseAskFlowerContextActionEnvelope(fixture.action, 'strict-input') !== null).toBe(
      fixture.name.startsWith('canonical_'),
    );
  });

  it('keeps historical file selections display-only', () => {
    const action = {
      ...baseAction,
      context: [{
        kind: 'file_selection',
        path: '/workspace/index.ts',
        selection: 'const answer = 42;',
        selection_chars: 18,
      }],
    };

    expect(parseAskFlowerContextActionEnvelope(action, 'strict-input')).toBeNull();
    expect(parseChatContextAction(action)?.chips[0]).toMatchObject({
      kind: 'file_selection',
      label: 'Selected content',
    });
  });

  it('recovers historical empty text content only for display', () => {
    const action = {
      ...baseAction,
      source: { surface: 'git_browser' },
      context: [{ kind: 'text_snapshot', title: 'Git changes' }],
    };

    expect(parseAskFlowerContextActionEnvelope(action, 'strict-input')).toBeNull();
    expect(parseChatContextAction(action)?.chips[0]).toMatchObject({
      kind: 'text_snapshot',
      label: 'Git changes',
    });
  });

  it('shows a damaged individual item as unsupported without exposing its payload', () => {
    const action = {
      ...baseAction,
      context: [
        baseAction.context[0],
        { kind: 'file_path', path: 42, secret: 'do not display' },
      ],
    };

    const display = parseChatContextAction(action);
    expect(display?.chips).toHaveLength(2);
    expect(display?.chips[1]).toEqual(expect.objectContaining({
      kind: 'file_path',
      label: 'Unsupported linked context',
      detail: 'file_path',
      action: null,
    }));
    expect(JSON.stringify(display?.chips[1])).not.toContain('do not display');
  });

  it('rejects wrong envelope identity and known surface-kind mismatches', () => {
    expect(parseChatContextAction({ ...baseAction, provider: 'codex' })).toBeNull();
    expect(parseChatContextAction({
      ...baseAction,
      context: [{
        kind: 'process_snapshot',
        pid: 42,
        name: 'worker',
        username: 'demo',
        cpu_percent: 0,
        memory_bytes: 0,
        platform: 'darwin',
        captured_at_ms: 1000,
      }],
    })).toBeNull();
  });
});
