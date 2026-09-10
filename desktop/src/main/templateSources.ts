import { captureSource, discoverSources, TemplateSourceError } from '@floegence/redeven-service-templates';
import { normalizeTemplateSourceRequest, type TemplateSourceAcquireResponse } from '../shared/desktopTemplateSources';

// Only the owning Environment renderer may acquire or cancel a source. Tokens
// are passed to the released acquisition SDK and never enter durable state.
export class DesktopTemplateSources {
  private readonly operations = new Map<string, AbortController>();

  async acquire(owner: number, request: unknown): Promise<TemplateSourceAcquireResponse> {
    const input = normalizeTemplateSourceRequest(request);
    if (!input) return { ok: false, error_code: 'REQUEST_INVALID' };
    const key = `${owner}:${input.operation_id}`;
    if (this.operations.has(key) || this.operations.size >= 8)
      return { ok: false, error_code: 'TEMPLATE_SOURCE_REVIEW_LIMIT' };
    const controller = new AbortController();
    this.operations.set(key, controller);
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
    try {
      const options = { signal: controller.signal };
      if (input.action === 'discover')
        return { ok: true, catalog: await discoverSources(input.source, input.token, options) };
      return { ok: true, snapshot: await captureSource(input.source, input.token, options) };
    } catch (error) {
      return {
        ok: false,
        error_code: controller.signal.aborted
          ? 'TEMPLATE_SOURCE_CANCELLED'
          : error instanceof TemplateSourceError
            ? error.code
            : 'TEMPLATE_SOURCE_UNAVAILABLE',
      };
    } finally {
      clearTimeout(timeout);
      this.operations.delete(key);
    }
  }

  cancel(owner: number, operationID: unknown): void {
    if (typeof operationID === 'string') this.operations.get(`${owner}:${operationID}`)?.abort();
  }
  cancelOwner(owner: number): void {
    for (const [key, controller] of this.operations) if (key.startsWith(`${owner}:`)) controller.abort();
  }
}
