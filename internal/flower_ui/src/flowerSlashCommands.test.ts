import { describe, expect, it } from 'vitest';

import { FLOWER_COMPACT_CONTEXT_COMMAND, parseFlowerSlashCommand } from './flowerSlashCommands';

describe('Flower slash commands', () => {
  it('parses only the exact compact command as an intent', () => {
    expect(parseFlowerSlashCommand('/compact')).toEqual({ kind: 'intent', command: FLOWER_COMPACT_CONTEXT_COMMAND });
    expect(parseFlowerSlashCommand('  /compact  ')).toEqual({ kind: 'intent', command: FLOWER_COMPACT_CONTEXT_COMMAND });
  });

  it('suggests compact while its prefix is incomplete', () => {
    expect(parseFlowerSlashCommand('/')).toEqual({ kind: 'suggest', query: '' });
    expect(parseFlowerSlashCommand('/com')).toEqual({ kind: 'suggest', query: 'com' });
  });

  it('rejects arguments and unknown commands', () => {
    expect(parseFlowerSlashCommand('/compact now')).toEqual({ kind: 'invalid', reason: 'arguments', command: '/compact' });
    expect(parseFlowerSlashCommand('/unknown')).toEqual({ kind: 'invalid', reason: 'unknown', command: '/unknown' });
  });

  it('leaves ordinary messages alone', () => {
    expect(parseFlowerSlashCommand('please compact later')).toEqual({ kind: 'none' });
  });
});
