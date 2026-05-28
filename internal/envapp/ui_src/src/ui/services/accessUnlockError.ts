export class AccessUnlockError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs: number;

  constructor(args: Readonly<{ message: string; status?: number; code?: string; retryAfterMs?: number }>) {
    super(String(args.message ?? 'Unlock failed'));
    this.name = 'AccessUnlockError';
    this.status = Number.isFinite(args.status) ? Math.max(0, Math.floor(args.status!)) : 0;
    this.code = String(args.code ?? '').trim();
    this.retryAfterMs = normalizeRetryAfterMs(args.retryAfterMs);
  }
}

export function isKnownAccessUnlockErrorCode(code: string): boolean {
  switch (String(code ?? '').trim().toUpperCase()) {
    case 'ACCESS_PASSWORD_INVALID':
    case 'ACCESS_PASSWORD_RETRY_LATER':
    case 'ACCESS_PASSWORD_REQUIRED':
      return true;
    default:
      return false;
  }
}

export function normalizeRetryAfterMs(value: unknown): number {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.max(0, Math.floor(num));
}

export function getAccessUnlockRetryAfterMs(error: unknown): number {
  if (error instanceof AccessUnlockError) {
    return normalizeRetryAfterMs(error.retryAfterMs);
  }
  return 0;
}

export function formatAccessUnlockRetryAfter(
  ms: number,
  units: Readonly<{ minute: string; second: string }> = { minute: 'm', second: 's' },
): string {
  const totalSeconds = Math.max(1, Math.ceil(normalizeRetryAfterMs(ms) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const minuteUnit = String(units.minute ?? 'm');
  const secondUnit = String(units.second ?? 's');
  if (minutes > 0 && seconds > 0) {
    return `${minutes}${minuteUnit} ${seconds}${secondUnit}`;
  }
  if (minutes > 0) {
    return `${minutes}${minuteUnit}`;
  }
  return `${seconds}${secondUnit}`;
}
