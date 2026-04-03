import {
  normalizeControlPlaneOrigin,
  normalizeDesktopControlPlaneAccount,
  normalizeDesktopControlPlaneProvider,
  normalizeDesktopProviderEnvironmentList,
  type DesktopControlPlaneAccount,
  type DesktopControlPlaneProvider,
  type DesktopProviderEnvironment,
} from '../shared/controlPlaneProvider';

const PROVIDER_DISCOVERY_PATH = '/.well-known/redeven-provider.json';
const PROVIDER_ME_PATH = '/api/rcpp/v1/me';
const PROVIDER_ENVIRONMENTS_PATH = '/api/rcpp/v1/environments';
const PROVIDER_BOOTSTRAP_EXCHANGE_PATH = '/api/rcpp/v1/runtime/bootstrap/exchange';
const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

type ProviderBootstrapTicketResponse = Readonly<{
  bootstrap_ticket: string;
  expires_at_unix_ms: number;
}>;

type ProviderJSONErrorEnvelope = Readonly<{
  error?: Readonly<{
    code?: unknown;
    message?: unknown;
  }> | null;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function providerRequestURL(providerOrigin: string, pathname: string): string {
  const base = new URL(normalizeControlPlaneOrigin(providerOrigin));
  base.pathname = pathname;
  base.search = '';
  base.hash = '';
  return base.toString();
}

async function readResponseJSON(response: Response): Promise<unknown> {
  const body = await response.text();
  if (compact(body) === '') {
    return null;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    if (!response.ok) {
      throw new Error(`Provider request failed (${response.status}): ${compact(body) || 'Invalid JSON response.'}`);
    }
    throw new Error('Provider returned invalid JSON.');
  }
}

function providerErrorMessage(response: Response, body: unknown): string {
  if (body && typeof body === 'object') {
    const envelope = body as ProviderJSONErrorEnvelope;
    const message = compact(envelope.error?.message);
    if (message !== '') {
      return message;
    }
  }
  return `Provider request failed (${response.status}).`;
}

async function fetchProviderJSON(
  url: string,
  options: Readonly<{
    method?: 'GET' | 'POST';
    sessionToken?: string;
  }> = {},
): Promise<unknown> {
  const headers = new Headers({
    Accept: 'application/json',
    'Cache-Control': 'no-store',
  });
  const sessionToken = compact(options.sessionToken);
  if (sessionToken !== '') {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
  });
  const body = await readResponseJSON(response);
  if (!response.ok) {
    throw new Error(providerErrorMessage(response, body));
  }
  return body;
}

export async function fetchProviderDiscovery(providerOrigin: string): Promise<DesktopControlPlaneProvider> {
  const body = await fetchProviderJSON(providerRequestURL(providerOrigin, PROVIDER_DISCOVERY_PATH));
  const provider = normalizeDesktopControlPlaneProvider(body);
  if (!provider) {
    throw new Error('Provider discovery response is invalid.');
  }
  return provider;
}

export async function fetchProviderAccount(
  provider: DesktopControlPlaneProvider,
  sessionToken: string,
): Promise<DesktopControlPlaneAccount> {
  const body = await fetchProviderJSON(
    providerRequestURL(provider.provider_origin, PROVIDER_ME_PATH),
    { sessionToken },
  );
  const account = normalizeDesktopControlPlaneAccount(body, {
    provider,
    sessionToken,
  });
  if (!account) {
    throw new Error('Provider account response is invalid.');
  }
  return account;
}

export async function fetchProviderEnvironments(
  provider: DesktopControlPlaneProvider,
  sessionToken: string,
): Promise<readonly DesktopProviderEnvironment[]> {
  const body = await fetchProviderJSON(
    providerRequestURL(provider.provider_origin, PROVIDER_ENVIRONMENTS_PATH),
    { sessionToken },
  );
  return normalizeDesktopProviderEnvironmentList(body, { provider });
}

export async function requestDesktopBootstrapTicket(
  provider: DesktopControlPlaneProvider,
  sessionToken: string,
  envPublicID: string,
): Promise<ProviderBootstrapTicketResponse> {
  const cleanEnvPublicID = compact(envPublicID);
  if (cleanEnvPublicID === '') {
    throw new Error('Environment ID is required.');
  }
  const body = await fetchProviderJSON(
    providerRequestURL(
      provider.provider_origin,
      `${PROVIDER_ENVIRONMENTS_PATH}/${encodeURIComponent(cleanEnvPublicID)}/desktop/bootstrap-ticket`,
    ),
    {
      method: 'POST',
      sessionToken,
    },
  );
  if (!body || typeof body !== 'object') {
    throw new Error('Provider bootstrap response is invalid.');
  }

  const candidate = body as Record<string, unknown>;
  const bootstrapTicket = compact(candidate.bootstrap_ticket);
  const expiresAtUnixMS = Number(candidate.expires_at_unix_ms);
  if (bootstrapTicket === '' || !Number.isFinite(expiresAtUnixMS) || expiresAtUnixMS <= 0) {
    throw new Error('Provider bootstrap response is invalid.');
  }
  return {
    bootstrap_ticket: bootstrapTicket,
    expires_at_unix_ms: Math.floor(expiresAtUnixMS),
  };
}

export function providerBootstrapExchangeURL(providerOrigin: string): string {
  return providerRequestURL(providerOrigin, PROVIDER_BOOTSTRAP_EXCHANGE_PATH);
}
