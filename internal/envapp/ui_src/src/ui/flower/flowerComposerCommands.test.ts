import { describe, expect, it } from 'vitest';

import {
  filterFlowerSlashCommands,
  flowerSlashCommands,
} from './flowerComposerCommands';

describe('flowerComposerCommands', () => {
  it('returns the default Flower slash commands in stable order', () => {
    expect(flowerSlashCommands().map((command) => command.id)).toEqual([
      'clear',
      'plan',
      'act',
      'cwd',
    ]);
  });

  it('filters commands by availability flags', () => {
    const commands = filterFlowerSlashCommands({
      query: '',
      context: {
        workingDirEditable: false,
        supportsExecutionModeSwitching: false,
      },
    });

    expect(commands.map((command) => command.id)).toEqual(['clear']);
  });

  it('prefers exact matches and supports aliases', () => {
    expect(filterFlowerSlashCommands({
      query: 'plan',
      context: {
        workingDirEditable: true,
        supportsExecutionModeSwitching: true,
      },
    }).map((command) => command.id)).toEqual(['plan']);

    expect(filterFlowerSlashCommands({
      query: 'workdir',
      context: {
        workingDirEditable: true,
        supportsExecutionModeSwitching: true,
      },
    }).map((command) => command.id)).toEqual(['cwd']);
  });
});
