import type { GitSource, Snapshot, SourceCatalog, SourceExpectation } from '@floegence/redeven-service-templates';

export const TEMPLATE_SOURCE_ACQUIRE_CHANNEL = 'redeven-desktop:template-source-acquire';
export const TEMPLATE_SOURCE_CANCEL_CHANNEL = 'redeven-desktop:template-source-cancel';

export type TemplateSourceAcquireRequest = {
  operation_id: string;
  action: 'discover' | 'capture';
  source: GitSource;
  token?: string;
  expected?: SourceExpectation;
};
export type TemplateSourceAcquireResponse = {
  ok: boolean;
  catalog?: SourceCatalog;
  snapshot?: Snapshot;
  error_code?: string;
};
export interface DesktopTemplateSourceBridge {
  acquire(request: TemplateSourceAcquireRequest): Promise<TemplateSourceAcquireResponse>;
  cancel(operationID: string): Promise<void>;
}

export function normalizeTemplateSourceRequest(value: unknown): TemplateSourceAcquireRequest | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.operation_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(input.operation_id)) return null;
  if (input.action !== 'discover' && input.action !== 'capture') return null;
  if (!input.source || typeof input.source !== 'object') return null;
  const source = input.source as Record<string, unknown>;
  if (typeof source.repository !== 'string' || source.repository.length > 4096) return null;
  if (source.ref !== undefined && (typeof source.ref !== 'string' || source.ref.length > 256)) return null;
  if (source.path !== undefined && (typeof source.path !== 'string' || source.path.length > 1024)) return null;
  if (
    input.token !== undefined &&
    (typeof input.token !== 'string' || input.token.length > 4096 || /[\r\n\0]/u.test(input.token))
  )
    return null;
  let expected: SourceExpectation | undefined;
  if (input.expected !== undefined) {
    if (input.action !== 'capture' || !input.expected || typeof input.expected !== 'object') return null;
    const item = input.expected as Record<string, unknown>;
    if (!Number.isSafeInteger(item.repository_id) || Number(item.repository_id) <= 0 || typeof item.commit_sha !== 'string' || !/^[a-f0-9]{40}$/u.test(item.commit_sha) || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)) return null;
    expected = { repository_id: Number(item.repository_id), commit_sha: item.commit_sha, sha256: item.sha256 };
  }
  return {
    ...(expected ? { expected } : {}),
    operation_id: input.operation_id,
    action: input.action,
    source: {
      repository: source.repository,
      ref: source.ref as string | undefined,
      path: source.path as string | undefined,
    },
    token: input.token as string | undefined,
  };
}
