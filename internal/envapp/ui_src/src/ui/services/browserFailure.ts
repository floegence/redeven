export type BrowserFailureCode = 'BROWSER_INSTALL_REQUIRED' | 'BROWSER_DISABLED' | 'BROWSER_SERVICE_FAILED'
  | 'BROWSER_RECOVERY_BLOCKED' | 'BROWSER_GENERATION_CHANGED' | 'BROWSER_SOURCE_UNAVAILABLE'
  | 'BROWSER_OPEN_TIMEOUT' | 'BROWSER_OUTCOME_UNKNOWN' | 'BROWSER_OPEN_FAILED' | 'BROWSER_DISCONNECTED';
export class BrowserWorkspaceError extends Error {
  constructor(readonly code: BrowserFailureCode) { super(code); }
}
export function browserFailureCode(error: unknown): BrowserFailureCode {
  const code = (error as { code?: string })?.code;
  return codes.has(code ?? '') ? code as BrowserFailureCode : 'BROWSER_OPEN_FAILED';
}
const codes = new Set(['BROWSER_INSTALL_REQUIRED', 'BROWSER_DISABLED', 'BROWSER_SERVICE_FAILED', 'BROWSER_RECOVERY_BLOCKED', 'BROWSER_GENERATION_CHANGED', 'BROWSER_SOURCE_UNAVAILABLE', 'BROWSER_OPEN_TIMEOUT', 'BROWSER_OUTCOME_UNKNOWN', 'BROWSER_OPEN_FAILED', 'BROWSER_DISCONNECTED']);
