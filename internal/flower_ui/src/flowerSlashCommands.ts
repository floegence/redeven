import { trimString } from './flowerSurfaceModel';

export type FlowerSlashCommandIntent =
  | Readonly<{ kind: 'compact_context'; raw: '/compact' }>;

export type FlowerSlashCommandParseResult =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'suggest'; query: string }>
  | Readonly<{ kind: 'invalid'; message: string }>
  | Readonly<{ kind: 'intent'; intent: FlowerSlashCommandIntent }>;

export const FLOWER_COMPACT_CONTEXT_COMMAND = '/compact';

export function parseFlowerSlashCommand(value: string): FlowerSlashCommandParseResult {
  const raw = trimString(value);
  if (!raw.startsWith('/')) return { kind: 'none' };
  if (raw === '/') return { kind: 'suggest', query: '' };
  if (raw === FLOWER_COMPACT_CONTEXT_COMMAND) {
    return { kind: 'intent', intent: { kind: 'compact_context', raw: FLOWER_COMPACT_CONTEXT_COMMAND } };
  }
  if (FLOWER_COMPACT_CONTEXT_COMMAND.startsWith(raw)) {
    return { kind: 'suggest', query: raw.slice(1) };
  }
  if (raw.startsWith(`${FLOWER_COMPACT_CONTEXT_COMMAND} `)) {
    return { kind: 'invalid', message: 'The /compact command does not take arguments.' };
  }
  return { kind: 'invalid', message: `Unknown Flower command: ${raw}` };
}
