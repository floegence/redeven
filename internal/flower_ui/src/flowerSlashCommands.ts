import { trimString } from './flowerSurfaceModel';

export type FlowerSlashCommandParseResult =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'suggest'; query: string }>
  | Readonly<{ kind: 'invalid'; reason: 'arguments' | 'unknown'; command: string }>
  | Readonly<{ kind: 'intent'; command: '/compact' }>;

export const FLOWER_COMPACT_CONTEXT_COMMAND = '/compact';

export function parseFlowerSlashCommand(value: string): FlowerSlashCommandParseResult {
  const raw = trimString(value);
  if (!raw.startsWith('/')) return { kind: 'none' };
  if (raw === '/') return { kind: 'suggest', query: '' };
  if (raw === FLOWER_COMPACT_CONTEXT_COMMAND) return { kind: 'intent', command: FLOWER_COMPACT_CONTEXT_COMMAND };
  if (FLOWER_COMPACT_CONTEXT_COMMAND.startsWith(raw)) return { kind: 'suggest', query: raw.slice(1) };
  if (raw.startsWith(`${FLOWER_COMPACT_CONTEXT_COMMAND} `)) {
    return { kind: 'invalid', reason: 'arguments', command: FLOWER_COMPACT_CONTEXT_COMMAND };
  }
  return { kind: 'invalid', reason: 'unknown', command: raw };
}
