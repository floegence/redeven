import type { TerminalHistoryRetentionLimits } from '@floegence/floeterm-terminal-web/live';

export function parseTerminalHistoryLimits(lines: string, memoryMiB: string): TerminalHistoryRetentionLimits | null {
  const parse = (raw: string, multiplier: number): number | null | false => {
    if (!raw.trim()) return null;
    if (!/^\d+(?:\.\d+)?$/.test(raw.trim())) return false;
    const value = Number(raw) * multiplier;
    return Number.isSafeInteger(value) && value >= 0 ? value : false;
  };
  const max_lines = parse(lines, 1), max_bytes = parse(memoryMiB, 1048576);
  return max_lines === false || max_bytes === false ? null : { max_lines, max_bytes };
}

// A byte is an exact binary fraction of MiB. Avoid exponent notation so a
// persisted one-byte budget remains editable by the same decimal parser.
export function formatTerminalHistoryMemory(bytes: number | null): string {
  return bytes === null ? '' : bytes === 0 ? '0' : (bytes / 1048576).toFixed(20).replace(/\.?0+$/, '');
}
