import { net } from 'electron';

import { normalizeControlPlaneOrigin } from '../shared/controlPlaneProvider';

const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_CERT_AUTHORITY_INVALID',
  'ERR_CERT_DATE_INVALID',
  'ERR_CERT_INVALID',
  'ERR_CERT_WEAK_SIGNATURE_ALGORITHM',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

const DNS_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'ERR_NAME_NOT_RESOLVED',
]);

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_FAILED',
]);

export type DesktopProviderRequestErrorCode =
  | 'provider_tls_untrusted'
  | 'provider_dns_failed'
  | 'provider_connection_failed'
  | 'provider_timeout'
  | 'provider_invalid_json'
  | 'provider_invalid_response'
  | 'provider_request_failed';

export class DesktopProviderRequestError extends Error {
  readonly code: DesktopProviderRequestErrorCode;

  readonly providerOrigin: string;

  readonly status: number;

  declare readonly cause: unknown;

  constructor(
    code: DesktopProviderRequestErrorCode,
    message: string,
    options: Readonly<{
      providerOrigin?: string;
      status?: number;
      cause?: unknown;
    }> = {},
  ) {
    super(message);
    this.name = 'DesktopProviderRequestError';
    this.code = code;
    this.providerOrigin = compact(options.providerOrigin);
    this.status = normalizeStatus(options.status);
    this.cause = options.cause;
  }
}

export type DesktopProviderTransportRequest = Readonly<{
  url: string;
  method?: 'GET' | 'POST';
  headers?: Readonly<Record<string, string>>;
  body_text?: string;
  timeout_ms: number;
}>;

export type DesktopProviderTransportResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body_text: string;
}>;

export type DesktopProviderTransport = (
  request: DesktopProviderTransportRequest,
) => Promise<DesktopProviderTransportResponse>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeStatus(value: unknown): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 100 ? numeric : 0;
}

function providerOriginFromURL(url: string): string {
  try {
    return normalizeControlPlaneOrigin(url);
  } catch {
    return '';
  }
}

function normalizeHeaders(headers: Headers): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  headers.forEach((value, key) => {
    normalized[key] = value;
  });
  return Object.freeze(normalized);
}

function collectErrorMetadata(
  error: unknown,
  codes: Set<string>,
  messages: string[],
  visited: Set<unknown>,
): void {
  if (!error || typeof error !== 'object' || visited.has(error)) {
    return;
  }
  visited.add(error);

  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown; name?: unknown };
  const code = compact(candidate.code).toUpperCase();
  if (code !== '') {
    codes.add(code);
  }

  const name = compact(candidate.name).toLowerCase();
  if (name !== '') {
    messages.push(name);
  }

  const message = compact(candidate.message).toLowerCase();
  if (message !== '') {
    messages.push(message);
  }

  collectErrorMetadata(candidate.cause, codes, messages, visited);
}

function normalizeTransportFailure(url: string, error: unknown): DesktopProviderRequestError {
  const providerOrigin = providerOriginFromURL(url);
  const codes = new Set<string>();
  const messages: string[] = [];
  collectErrorMetadata(error, codes, messages, new Set<unknown>());

  const hasCode = (expected: ReadonlySet<string>): boolean => (
    [...codes].some((code) => expected.has(code))
  );
  const includesMessage = (pattern: string): boolean => (
    messages.some((message) => message.includes(pattern))
  );

  if (hasCode(TLS_ERROR_CODES) || includesMessage('certificate')) {
    return new DesktopProviderRequestError(
      'provider_tls_untrusted',
      'Desktop could not verify the Control Plane certificate. Trust that certificate on this machine, then try again.',
      { providerOrigin, cause: error },
    );
  }

  if (hasCode(DNS_ERROR_CODES) || includesMessage('name not resolved') || includesMessage('dns')) {
    return new DesktopProviderRequestError(
      'provider_dns_failed',
      'Desktop could not resolve the Control Plane host. Check the hostname and local DNS or hosts configuration, then try again.',
      { providerOrigin, cause: error },
    );
  }

  if (includesMessage('aborterror') || includesMessage('timed out') || includesMessage('timeout')) {
    return new DesktopProviderRequestError(
      'provider_timeout',
      'Desktop timed out waiting for the Control Plane to respond.',
      { providerOrigin, cause: error },
    );
  }

  if (hasCode(CONNECTION_ERROR_CODES) || includesMessage('connection refused') || includesMessage('connection reset')) {
    return new DesktopProviderRequestError(
      'provider_connection_failed',
      'Desktop could not reach the Control Plane. Make sure it is running and reachable from this machine, then try again.',
      { providerOrigin, cause: error },
    );
  }

  return new DesktopProviderRequestError(
    'provider_request_failed',
    'Desktop failed to talk to the Control Plane.',
    { providerOrigin, cause: error },
  );
}

export const electronDesktopProviderTransport: DesktopProviderTransport = async (
  request,
): Promise<DesktopProviderTransportResponse> => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    const cleanName = compact(name);
    const cleanValue = compact(value);
    if (cleanName === '' || cleanValue === '') {
      continue;
    }
    headers.set(cleanName, cleanValue);
  }

  let response: Response;
  try {
    response = await net.fetch(request.url, {
      method: request.method ?? 'GET',
      headers,
      body: compact(request.body_text) === '' ? undefined : request.body_text,
      signal: AbortSignal.timeout(request.timeout_ms),
    });
  } catch (error) {
    throw normalizeTransportFailure(request.url, error);
  }

  let bodyText = '';
  try {
    bodyText = await response.text();
  } catch (error) {
    throw new DesktopProviderRequestError(
      'provider_invalid_response',
      'Desktop could not read the Control Plane response.',
      {
        providerOrigin: providerOriginFromURL(request.url),
        status: response.status,
        cause: error,
      },
    );
  }

  return {
    status: response.status,
    headers: normalizeHeaders(response.headers),
    body_text: bodyText,
  };
};
