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
const PROVIDER_DESKTOP_CONNECT_EXCHANGE_PATH = '/api/rcpp/v1/desktop/connect/exchange';
const PROVIDER_DESKTOP_OPEN_EXCHANGE_PATH = '/api/rcpp/v1/desktop/open/exchange';
const PROVIDER_DESKTOP_TOKEN_REFRESH_PATH = '/api/rcpp/v1/desktop/token/refresh';
const PROVIDER_DESKTOP_TOKEN_REVOKE_PATH = '/api/rcpp/v1/desktop/token/revoke';
const PROVIDER_DESKTOP_OPEN_SESSION_PATH_SUFFIX = '/desktop/open-session';
const PROVIDER_BOOTSTRAP_EXCHANGE_PATH = '/api/rcpp/v1/runtime/bootstrap/exchange';
const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

export type ProviderDesktopOpenSession = Readonly<{
  bootstrap_ticket?: string;
  remote_session_url?: string;
  expires_at_unix_ms: number;
}>;

export type ProviderDesktopConnectExchangeResult = Readonly<{
  access_token: string;
  access_expires_at_unix_ms: number;
  refresh_token: string;
  authorization_expires_at_unix_ms: number;
  account: DesktopControlPlaneAccount;
  environments: readonly DesktopProviderEnvironment[];
}>;

export type ProviderDesktopTokenRefreshResult = Readonly<{
  access_token: string;
  access_expires_at_unix_ms: number;
  authorization_expires_at_unix_ms: number;
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

function normalizeUnixMS(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('Provider response is invalid.');
  }
  return Math.floor(numeric);
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
    bearerToken?: string;
    body?: unknown;
  }> = {},
): Promise<unknown> {
  const headers = new Headers({
    Accept: 'application/json',
    'Cache-Control': 'no-store',
  });
  const bearerToken = compact(options.bearerToken);
  if (bearerToken !== '') {
    headers.set('Authorization', `Bearer ${bearerToken}`);
  }
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(DEFAULT_PROVIDER_TIMEOUT_MS),
  });
  const body = await readResponseJSON(response);
  if (!response.ok) {
    throw new Error(providerErrorMessage(response, body));
  }
  return body;
}

function normalizeProviderOpenSessionResponse(body: unknown): ProviderDesktopOpenSession {
  if (!body || typeof body !== 'object') {
    throw new Error('Provider open response is invalid.');
  }

  const candidate = body as Record<string, unknown>;
  const bootstrapTicket = compact(candidate.bootstrap_ticket);
  const remoteSessionURL = compact(candidate.remote_session_url);
  if (bootstrapTicket === '' && remoteSessionURL === '') {
    throw new Error('Provider open response is invalid.');
  }
  return {
    bootstrap_ticket: bootstrapTicket || undefined,
    remote_session_url: remoteSessionURL || undefined,
    expires_at_unix_ms: normalizeUnixMS(candidate.expires_at_unix_ms),
  };
}

function normalizeProviderDesktopTokenRefreshResponse(body: unknown): ProviderDesktopTokenRefreshResult {
  if (!body || typeof body !== 'object') {
    throw new Error('Provider refresh response is invalid.');
  }

  const candidate = body as Record<string, unknown>;
  const accessToken = compact(candidate.access_token);
  if (accessToken === '') {
    throw new Error('Provider refresh response is invalid.');
  }
  return {
    access_token: accessToken,
    access_expires_at_unix_ms: normalizeUnixMS(candidate.access_expires_at_unix_ms),
    authorization_expires_at_unix_ms: normalizeUnixMS(candidate.authorization_expires_at_unix_ms),
  };
}

function normalizeProviderDesktopConnectExchangeResponse(
  provider: DesktopControlPlaneProvider,
  body: unknown,
): ProviderDesktopConnectExchangeResult {
  if (!body || typeof body !== 'object') {
    throw new Error('Provider connect response is invalid.');
  }

  const candidate = body as Record<string, unknown>;
  const accessToken = compact(candidate.access_token);
  const refreshToken = compact(candidate.refresh_token);
  const authorizationExpiresAtUnixMS = normalizeUnixMS(candidate.authorization_expires_at_unix_ms);
  if (accessToken === '' || refreshToken === '') {
    throw new Error('Provider connect response is invalid.');
  }

  const account = normalizeDesktopControlPlaneAccount({
    ...(candidate.account && typeof candidate.account === 'object'
      ? candidate.account as Record<string, unknown>
      : {}),
    authorization_expires_at_unix_ms: authorizationExpiresAtUnixMS,
  }, { provider });
  if (!account) {
    throw new Error('Provider connect response is invalid.');
  }

  return {
    access_token: accessToken,
    access_expires_at_unix_ms: normalizeUnixMS(candidate.access_expires_at_unix_ms),
    refresh_token: refreshToken,
    authorization_expires_at_unix_ms: authorizationExpiresAtUnixMS,
    account,
    environments: normalizeDesktopProviderEnvironmentList({
      environments: Array.isArray(candidate.environments) ? candidate.environments : [],
    }, { provider }),
  };
}

export async function fetchProviderDiscovery(providerOrigin: string): Promise<DesktopControlPlaneProvider> {
  const body = await fetchProviderJSON(providerRequestURL(providerOrigin, PROVIDER_DISCOVERY_PATH));
  const provider = normalizeDesktopControlPlaneProvider(body);
  if (!provider) {
    throw new Error('Provider discovery response is invalid.');
  }
  return provider;
}

export async function exchangeProviderDesktopConnectHandoff(
  provider: DesktopControlPlaneProvider,
  handoffTicket: string,
): Promise<ProviderDesktopConnectExchangeResult> {
  const body = await fetchProviderJSON(
    providerRequestURL(provider.provider_origin, PROVIDER_DESKTOP_CONNECT_EXCHANGE_PATH),
    {
      method: 'POST',
      bearerToken: handoffTicket,
    },
  );
  return normalizeProviderDesktopConnectExchangeResponse(provider, body);
}

export async function exchangeProviderDesktopOpenHandoff(
  providerOrigin: string,
  handoffTicket: string,
): Promise<ProviderDesktopOpenSession> {
  const body = await fetchProviderJSON(
    providerRequestURL(providerOrigin, PROVIDER_DESKTOP_OPEN_EXCHANGE_PATH),
    {
      method: 'POST',
      bearerToken: handoffTicket,
    },
  );
  return normalizeProviderOpenSessionResponse(body);
}

export async function refreshProviderDesktopAccessToken(
  provider: DesktopControlPlaneProvider,
  refreshToken: string,
): Promise<ProviderDesktopTokenRefreshResult> {
  const body = await fetchProviderJSON(
    providerRequestURL(provider.provider_origin, PROVIDER_DESKTOP_TOKEN_REFRESH_PATH),
    {
      method: 'POST',
      body: {
        refresh_token: compact(refreshToken),
      },
    },
  );
  return normalizeProviderDesktopTokenRefreshResponse(body);
}

export async function revokeProviderDesktopAuthorization(
  provider: DesktopControlPlaneProvider,
  refreshToken: string,
): Promise<void> {
  await fetchProviderJSON(
    providerRequestURL(provider.provider_origin, PROVIDER_DESKTOP_TOKEN_REVOKE_PATH),
    {
      method: 'POST',
      body: {
        refresh_token: compact(refreshToken),
      },
    },
  );
}

export async function fetchProviderAccount(
  provider: DesktopControlPlaneProvider,
  accessToken: string,
): Promise<DesktopControlPlaneAccount> {
  const body = await fetchProviderJSON(
    providerRequestURL(provider.provider_origin, PROVIDER_ME_PATH),
    { bearerToken: accessToken },
  );
  const account = normalizeDesktopControlPlaneAccount(body, { provider });
  if (!account) {
    throw new Error('Provider account response is invalid.');
  }
  return account;
}

export async function fetchProviderEnvironments(
  provider: DesktopControlPlaneProvider,
  accessToken: string,
): Promise<readonly DesktopProviderEnvironment[]> {
  const body = await fetchProviderJSON(
    providerRequestURL(provider.provider_origin, PROVIDER_ENVIRONMENTS_PATH),
    { bearerToken: accessToken },
  );
  return normalizeDesktopProviderEnvironmentList(body, { provider });
}

export async function requestDesktopBootstrapTicket(
  provider: DesktopControlPlaneProvider,
  accessToken: string,
  envPublicID: string,
): Promise<ProviderDesktopOpenSession> {
  const cleanEnvPublicID = compact(envPublicID);
  if (cleanEnvPublicID === '') {
    throw new Error('Environment ID is required.');
  }
  const body = await fetchProviderJSON(
    providerRequestURL(
      provider.provider_origin,
      `${PROVIDER_ENVIRONMENTS_PATH}/${encodeURIComponent(cleanEnvPublicID)}${PROVIDER_DESKTOP_OPEN_SESSION_PATH_SUFFIX}`,
    ),
    {
      method: 'POST',
      bearerToken: accessToken,
    },
  );
  return normalizeProviderOpenSessionResponse(body);
}

export function providerBootstrapExchangeURL(providerOrigin: string): string {
  return providerRequestURL(providerOrigin, PROVIDER_BOOTSTRAP_EXCHANGE_PATH);
}
