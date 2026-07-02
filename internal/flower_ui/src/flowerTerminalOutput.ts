export type TerminalVisibleOutputStatus = 'running' | 'pending' | 'success' | 'error' | 'canceled' | 'waiting' | string;

function normalizeOutput(value: unknown): string {
  return String(value ?? '').replace(/\r\n?/g, '\n');
}

function isLiveStatus(status: TerminalVisibleOutputStatus | undefined): boolean {
  const value = String(status ?? '').trim().toLowerCase();
  return value === 'running' || value === 'pending' || value === 'waiting';
}

export function mergeTerminalVisibleOutput(previous: unknown, next: unknown, _status?: TerminalVisibleOutputStatus): string {
  const current = normalizeOutput(previous);
  const incoming = normalizeOutput(next);
  if (!incoming.trim()) {
    return current;
  }
  if (!current.trim()) return incoming;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.includes(incoming)) return current;
  return `${current}${current.endsWith('\n') || incoming.startsWith('\n') ? '' : '\n'}${incoming}`;
}

export function terminalListeningPlaceholderVisible(output: unknown, status: TerminalVisibleOutputStatus | undefined): boolean {
  return isLiveStatus(status) && !normalizeOutput(output).trim();
}
