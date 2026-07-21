import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseAskFlowerContextActionEnvelope } from '../contextActionWire';
import { parseChatContextAction, parseChatMessageReferences } from './flowerChatContextModel';

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
  it('projects ordered canonical references without accepting host ResourceRef fields', () => {
    const longUnicode = '引用内容'.repeat(80);
    const display = parseChatMessageReferences([
      { reference_id: 'ref-text', kind: 'text', label: 'Quoted selection', text: longUnicode, truncated: true },
      { reference_id: 'ref-file', kind: 'file', label: 'src/index.ts' },
      { reference_id: 'ref-dir', kind: 'directory', label: 'src' },
      { reference_id: 'ref-terminal', kind: 'terminal', label: 'Terminal output', text: 'pnpm test\nPASS' },
      { reference_id: 'ref-process', kind: 'process', label: 'vite (4242)' },
    ]);

    expect(display?.authority).toBe('canonical_references');
    expect(display?.chips.map((chip) => chip.kind)).toEqual(['text', 'file', 'directory', 'terminal', 'process']);
    expect(display?.chips.map((chip) => chip.id)).toEqual([
      'ref-text',
      'ref-file',
      'ref-dir',
      'ref-terminal',
      'ref-process',
    ]);
    expect(Array.from(display?.chips[0]?.detail ?? '')).toHaveLength(99);
    expect(display?.chips[0]?.action).toMatchObject({
      type: 'open_text_preview',
      body: longUnicode,
      context_index: 0,
    });
    expect(display?.chips[0]).toMatchObject({ truncated: true });
    expect(display?.chips[0]?.action).toMatchObject({ truncated: true });
		expect(display?.chips[1]?.action).toEqual({
			type: 'open_canonical_reference',
			reference_id: 'ref-file',
		});
		expect(display?.chips[2]?.action).toEqual({
			type: 'open_canonical_reference',
			reference_id: 'ref-dir',
		});
    expect(display?.chips[4]).toMatchObject({ detail: '', action: null });
    expect(JSON.stringify(display)).not.toContain('resource_ref');
  });

  it('returns no canonical reference display for an empty list', () => {
    expect(parseChatMessageReferences([])).toBeNull();
  });

  it.each(fixtures)('parses shared wire fixture $name', (fixture) => {
    const parsed = parseAskFlowerContextActionEnvelope(fixture.action);
    const display = parseChatContextAction(fixture.action);
    const canonical = fixture.name.startsWith('canonical_');
    expect(parsed !== null).toBe(canonical);
    expect(display !== null).toBe(canonical);
    if (canonical) {
      expect(display?.chips).toHaveLength(1);
      expect(display?.authority).toBe('queued_context_action');
      expect(display?.chips[0]).toMatchObject({
        kind: fixture.expect_kind,
        label: fixture.expect_label,
      });
    }
  });

  it('builds indexed host actions for mixed file and directory context', () => {
    const display = parseChatContextAction({
      ...baseAction,
      source: { surface: 'file_browser' },
      context: [
        { kind: 'file_path', path: '/workspace/index.ts', is_directory: false },
        { kind: 'file_path', path: '/workspace/src', is_directory: true },
      ],
    });

    expect(display?.chips[0]?.action).toEqual({
      type: 'open_linked_file_preview',
      path: '/workspace/index.ts',
      context_index: 0,
    });
    expect(display?.chips[1]?.action).toEqual({
      type: 'open_linked_directory_browser',
      path: '/workspace/src',
      context_index: 1,
    });
  });

  it('rejects queued text context without canonical content', () => {
    const action = {
      ...baseAction,
      source: { surface: 'git_browser' },
      context: [{ kind: 'text_snapshot', title: 'Git changes' }],
    };

    expect(parseAskFlowerContextActionEnvelope(action)).toBeNull();
    expect(parseChatContextAction(action)).toBeNull();
  });

  it('rejects the complete queued context action when any item is damaged', () => {
    const action = {
      ...baseAction,
      context: [
        baseAction.context[0],
        { kind: 'file_path', path: 42, secret: 'do not display' },
      ],
    };

    expect(parseChatContextAction(action)).toBeNull();
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
