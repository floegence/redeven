import { describe, expect, it } from 'vitest';

import { FLOWER_COMPACT_CONTEXT_COMMAND, parseFlowerSlashCommand } from './flowerSlashCommands';

describe('Flower slash commands', () => {
  it('parses the compact command only when it is exact', () => {
    expect(parseFlowerSlashCommand('/compact')).toEqual({
      kind: 'intent',
      intent: {
        kind: 'compact_context',
        raw: FLOWER_COMPACT_CONTEXT_COMMAND,
      },
    });
    expect(parseFlowerSlashCommand('  /compact  ')).toEqual({
      kind: 'intent',
      intent: {
        kind: 'compact_context',
        raw: FLOWER_COMPACT_CONTEXT_COMMAND,
      },
    });
  });

  it('suggests compact while the command prefix is incomplete', () => {
    expect(parseFlowerSlashCommand('/')).toEqual({ kind: 'suggest', query: '' });
    expect(parseFlowerSlashCommand('/com')).toEqual({ kind: 'suggest', query: 'com' });
  });

  it('rejects compact arguments instead of treating them as chat text', () => {
    expect(parseFlowerSlashCommand('/compact now')).toEqual({
      kind: 'invalid',
      message: 'The /compact command does not take arguments.',
    });
  });

  it('leaves non-command drafts alone', () => {
    expect(parseFlowerSlashCommand('please compact later')).toEqual({ kind: 'none' });
  });
});
