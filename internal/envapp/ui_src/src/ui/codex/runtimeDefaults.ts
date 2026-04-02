export const CODEX_DEFAULT_APPROVAL_POLICY = 'never';
export const CODEX_DEFAULT_SANDBOX_MODE = 'danger-full-access';

export function resolveCodexApprovalPolicyValue(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  return normalized || CODEX_DEFAULT_APPROVAL_POLICY;
}

export function resolveCodexSandboxModeValue(value: string | null | undefined): string {
  const normalized = String(value ?? '').trim();
  return normalized || CODEX_DEFAULT_SANDBOX_MODE;
}
