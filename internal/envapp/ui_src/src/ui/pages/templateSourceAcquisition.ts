import { secureRandomUUID } from '@floegence/floe-webapp-core';
import type { GitSource, Snapshot, SourceExpectation } from '@floegence/redeven-service-templates';
import { fetchLocalApiJSON, LocalApiError } from '../services/localApi';
import type { SourcePreview } from './GitTemplateImport';

export type TemplateSourceTransferMode = 'desktop_transfer' | 'remote_download';

// Both explicit imports and deployment preparation use the published reader.
// This only acquires an owner-scoped review; it never accepts or installs it.
export async function inspectTemplateSource(request: {
  source: GitSource;
  expected?: SourceExpectation;
  templateID?: string;
  mode: TemplateSourceTransferMode;
  token?: string;
}, signal: AbortSignal, onTransfer?: () => void): Promise<SourcePreview> {
  signal.throwIfAborted();
  const bridge = window.redevenDesktopTemplateSources;
  if (request.mode === 'desktop_transfer' && !bridge) throw new LocalApiError({message: '', code: 'TEMPLATE_SOURCE_UNAVAILABLE'});
  const operationID = secureRandomUUID();
  const cancel = () => { void bridge?.cancel(operationID).catch(() => undefined); };
  let snapshot: Snapshot | undefined;
  if (request.mode === 'desktop_transfer' && bridge) {
    signal.addEventListener('abort', cancel, { once: true });
    try {
      const response = await bridge.acquire({operation_id: operationID, action: 'capture', source: request.source, expected: request.expected, token: request.token});
      signal.throwIfAborted();
      if (!response.ok) throw new LocalApiError({message: '', code: response.error_code});
      snapshot = response.snapshot;
      if (!snapshot) throw new LocalApiError({message: '', code: 'TEMPLATE_SOURCE_RESPONSE_INVALID'});
      onTransfer?.();
    } finally { signal.removeEventListener('abort', cancel); }
  }
  const result = await fetchLocalApiJSON<SourcePreview>('/_redeven_proxy/api/managed-web-service-templates/source-previews', {
    method: 'POST', signal,
    body: JSON.stringify({template_id: request.templateID, source: request.source, expected: request.expected, ...(snapshot ? {snapshot} : {token: request.token})}),
  });
  signal.throwIfAborted();
  return result;
}
