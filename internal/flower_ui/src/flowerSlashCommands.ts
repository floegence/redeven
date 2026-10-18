import { trimString } from './flowerSurfaceModel';

export type FlowerSlashCommandParseResult =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'suggest'; query: string }>
  | Readonly<{ kind: 'invalid'; reason: 'arguments' | 'unknown'; command: string }>
  | Readonly<{ kind: 'intent'; command: '/compact' }>
  | Readonly<{ kind: 'intent'; command: '/goal'; operation: 'open' | 'set' | 'delete'; text?: string }>;

export const FLOWER_COMPACT_CONTEXT_COMMAND = '/compact';
export const FLOWER_GOAL_COMMAND = '/goal';

export function parseFlowerSlashCommand(value: string): FlowerSlashCommandParseResult {
  const raw = trimString(value);
  if (!raw.startsWith('/')) return { kind: 'none' };
  if (raw === '/') return { kind: 'suggest', query: '' };
  if (raw === FLOWER_GOAL_COMMAND) return { kind: 'intent', command: '/goal', operation: 'open' };
  if (/^\/goal\s/.test(raw)) {
    const text = raw.slice(FLOWER_GOAL_COMMAND.length).trim();
    return text === 'clear' ? { kind: 'intent', command: '/goal', operation: 'delete' }
      : { kind: 'intent', command: '/goal', operation: 'set', text };
  }
  if (raw === FLOWER_COMPACT_CONTEXT_COMMAND) return { kind: 'intent', command: FLOWER_COMPACT_CONTEXT_COMMAND };
  if ([FLOWER_COMPACT_CONTEXT_COMMAND, FLOWER_GOAL_COMMAND].some(command => command.startsWith(raw))) return { kind: 'suggest', query: raw.slice(1) };
  if (raw.startsWith(FLOWER_COMPACT_CONTEXT_COMMAND+' ')) return { kind: 'invalid', reason: 'arguments', command: FLOWER_COMPACT_CONTEXT_COMMAND };
  return { kind: 'invalid', reason: 'unknown', command: raw };
}
