import {
  normalizeControlPlaneOrigin,
  normalizeDesktopControlPlaneAccount,
  normalizeDesktopControlPlaneProvider,
  normalizeDesktopProviderEnvironmentList,
  type DesktopControlPlaneAccount,
  type DesktopControlPlaneProvider,
  type DesktopProviderEnvironment,
} from '../shared/controlPlaneProvider';
import {
  DesktopProviderRequestError,
  electronDesktopProviderTransport,
  type DesktopProviderTransport,
  type DesktopProviderTransportResponse,
} from './controlPlaneProviderTransport';

const PROVIDER_DISCOVERY_PATH = '/.well-known/redeven-provider.json';
const PROVIDER_ME_PATH = '/api/rcpp/v1/me';
const PROVIDER_ENVIRONMENTS_PATH = '/api/rcpp/v1/environments';
const PROVIDER_DESKTOP_CONNECT_EXCHANGE_PATH = '/api/rcpp/v1/desktop/connect/exchange';
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

export type ProviderDesktopConnectAuthorization = Readonly<{
  authorization_code: string;
  code_verifier: string;
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

type ProviderClientRequestOptions = Readonly<{
  transport?: DesktopProviderTransport;
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

function headersRecord(headers: Headers): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  headers.forEach((value, key) => {
    normalized[key] = value;
  });
  return normalized;
}

function invalidProviderResponseError(
  providerOrigin: string,
  message: string,
): DesktopProviderRequestError {
  return new DesktopProviderRequestError('provider_invalid_response', message, { providerOrigin });
}

function normalizeProviderUnixMS(
  providerOrigin: string,
  value: unknown,
  message: string,
): number {
  try {
    return normalizeUnixMS(value);
  } catch {
    throw invalidProviderResponseError(providerOrigin, message);
  }
}

async function readResponseJSON(
  providerOrigin: string,
  response: DesktopProviderTransportResponse,
  operationLabel: string,
): Promise<unknown> {
  const body = response.body_text;
  if (compact(body) === '') {
    return null;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new DesktopProviderRequestError(
      'provider_invalid_json',
      `The Control Plane returned invalid JSON for ${operationLabel}.`,
      {
        providerOrigin,
        status: response.status,
      },
    );
  }
}

function providerErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const envelope = body as ProviderJSONErrorEnvelope;
    const message = compact(envelope.error?.message);
    if (message !== '') {
      return message;
    }
  }
  return `Control Plane request failed (${status}).`;
}

async function fetchProviderJSON(
  url: string,
  options: Readonly<{
    method?: 'GET' | 'POST';
    bearerToken?: string;
    body?: unknown;
    operationLabel: string;
    transport?: DesktopProviderTransport;
  }>,
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

  const providerOrigin = normalizeControlPlaneOrigin(url);
  const transport = options.transport ?? electronDesktopProviderTransport;
  const response = await transport({
    url,
    method: options.method ?? 'GET',
    headers: headersRecord(headers),
    body_text: options.body === undefined ? undefined : JSON.stringify(options.body),
    timeout_ms: DEFAULT_PROVIDER_TIMEOUT_MS,
  });
  const body = await readResponseJSON(providerOrigin, response, options.operationLabel);
  if (response.status < 200 || response.status >= 300) {
    throw new DesktopProviderRequestError(
      'provider_request_failed',
      providerErrorMessage(response.status, body),
      {
        providerOrigin,
        status: response.status,
      },
    );
  }
  return body;
}

function normalizeProviderOpenSessionResponse(
  providerOrigin: string,
  body: unknown,
  message: string,
): ProviderDesktopOpenSession {
  if (!body || typeof body !== 'object') {
    throw invalidProviderResponseError(providerOrigin, message);
  }

  const candidate = body as Record<string, unknown>;
  const bootstrapTicket = compact(candidate.bootstrap_ticket);
  const remoteSessionURL = compact(candidate.remote_session_url);
  if (bootstrapTicket === '' && remoteSessionURL === '') {
    throw invalidProviderResponseError(providerOrigin, message);
  }
  return {
    bootstrap_ticket: bootstrapTicket || undefined,
    remote_session_url: remoteSessionURL || undefined,
    expires_at_unix_ms: normalizeProviderUnixMS(providerOrigin, candidate.expires_at_unix_ms, message),
  };
}

function normalizeProviderDesktopTokenRefreshResponse(
  providerOrigin: string,
  body: unknown,
): ProviderDesktopTokenRefreshResult {
  if (!body || typeof body !== 'object') {
    throw invalidProviderResponseError(
      providerOrigin,
      'The Control Plane desktop token refresh response is invalid.',
    );
  }

  const candidate = body as Record<string, unknown>;
  const accessToken = compact(candidate.access_token);
  if (accessToken === '') {
    throw invalidProviderResponseError(
      providerOrigin,
      'The Control Plane desktop token refresh response is invalid.',
    );
  }
  return {
    access_token: accessToken,
    access_expires_at_unix_ms: normalizeProviderUnixMS(
      providerOrigin,
      candidate.access_expires_at_unix_ms,
      'The Control Plane desktop token refresh response is invalid.',
    ),
    authorization_expires_at_unix_ms: normalizeProviderUnixMS(
      providerOrigin,
      candidate.authorization_expires_at_unix_ms,
      'The Control Plane desktop token refresh response is invalid.',
    ),
  };
}

function normalizeProviderDesktopConnectExchangeResponse(
  provider: DesktopControlPlaneProvider,
  body: unknown,
): ProviderDesktopConnectExchangeResult {
  if (!body || typeof body !== 'object') {
    throw invalidProviderResponseError(
      provider.provider_origin,
      'The Control Plane desktop connect response is invalid.',
    );
  }

  const candidate = body as Record<string, unknown>;
  const accessToken = compact(candidate.access_token);
  const refreshToken = compact(candidate.refresh_token);
  const authorizationExpiresAtUnixMS = normalizeProviderUnixMS(
    provider.provider_origin,
    candidate.authorization_expires_at_unix_ms,
    'The Control Plane desktop connect response is invalid.',
  );
  if (accessToken === '' || refreshToken === '') {
    throw invalidProviderResponseError(
      provider.provider_origin,
      'The Control Plane desktop connect response is invalid.',
    );
  }

  const account = normalizeDesktopControlPlaneAccount({
    ...(candidate.account && typeof candidate.account === 'object'
      ? candidate.account as Record<string, unknown>
      : {}),
    authorization_expires_at_unix_ms: authorizationExpiresAtUnixMS,
  }, { provider });
  if (!account) {
    throw invalidProviderResponseError(
      provider.provider_origin,
      'The Control Plane desktop connect response is invalid.',
    );
  }

  return {
    access_token: accessToken,
    access_expires_at_unix_ms: normalizeProviderUnixMS(
      provider.provider_origin,
      candidate.access_expires_at_unix_ms,
      'The Control Plane desktop connect response is invalid.',
    ),
    refresh_token: refreshToken,
    authorization_expires_at_unix_ms: authorizationExpiresAtUnixMS,
    account,
    environments: normalizeDesktopProviderEnvironmentList({
      environments: Array.isArray(candidate.environments) ? candidate.environments : [],
    }, { provider }),
  };
}

export async function fetchProviderDiscovery(
  providerOrigin: string,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<DesktopControlPlaneProvider> {
  const normalizedOrigin = normalizeControlPlaneOrigin(providerOrigin);
  const body = await fetchProviderJSON(providerRequestURL(normalizedOrigin, PROVIDER_DISCOVERY_PATH), {
    operationLabel: 'the provider discovery document',
    transport: requestOptions.transport,
  });
  const provider = normalizeDesktopControlPlaneProvider(body);
  if (!provider) {
    throw invalidProviderResponseError(
      normalizedOrigin,
      'The Control Plane provider discovery document is invalid.',
    );
  }
  return provider;
}

export async function exchangeProviderDesktopConnectAuthorization(
  provider: DesktopControlPlaneProvider,
  authorization: ProviderDesktopConnectAuthorization,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<ProviderDesktopConnectExchangeResult> {
  const body = await fetchProviderJSON(
    providerRequestURL(provider.provider_origin, PROVIDER_DESKTOP_CONNECT_EXCHANGE_PATH),
    {
      method: 'POST',
      body: {
        authorization_code: compact(authorization.authorization_code),
        code_verifier: compact(authorization.code_verifier),
      },
      operationLabel: 'the desktop connect exchange',
      transport: requestOptions.transport,
    },
  );
  return normalizeProviderDesktopConnectExchangeResponse(provider, body);
}

export async function refreshProviderDesktopAccessToken(
  provider: DesktopControlPlaneProvider,
  refreshToken: string,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<ProviderDesktopTokenRefreshResult> {
  const body = await fetchProviderJSON(
    providerRequestURL(provider.provider_origin, PROVIDER_DESKTOP_TOKEN_REFRESH_PATH),
    {
      method: 'POST',
      body: {
        refresh_token: compact(refreshToken),
      },
      operationLabel: 'the desktop token refresh response',
      transport: requestOptions.transport,
    },
  );
  return normalizeProviderDesktopTokenRefreshResponse(provider.provider_origin, body);
}

export async function revokeProviderDesktopAuthorization(
  provider: DesktopControlPlaneProvider,
  refreshToken: string,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<void> {
  await fetchProviderJSON(
    providerRequestURL(provider.provider_origin, PROVIDER_DESKTOP_TOKEN_REVOKE_PATH),
    {
      method: 'POST',
      body: {
        refresh_token: compact(refreshToken),
      },
      operationLabel: 'the desktop token revoke response',
      transport: requestOptions.transport,
    },
  );
}

export async function fetchProviderAccount(
  provider: DesktopControlPlaneProvider,
  accessToken: string,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<DesktopControlPlaneAccount> {
  const body = await fetchProviderJSON(
    providerRequestURL(provider.provider_origin, PROVIDER_ME_PATH),
    {
      bearerToken: accessToken,
      operationLabel: 'the account summary',
      transport: requestOptions.transport,
    },
  );
  const account = normalizeDesktopControlPlaneAccount(body, { provider });
  if (!account) {
    throw invalidProviderResponseError(
      provider.provider_origin,
      'The Control Plane account summary is invalid.',
    );
  }
  return account;
}

export async function fetchProviderEnvironments(
  provider: DesktopControlPlaneProvider,
  accessToken: string,
  requestOptions: ProviderClientRequestOptions = {},
): Promise<readonly DesktopProviderEnvironment[]> {
  const body = await fetchProviderJSON(
    providerRequestURL(provider.provider_origin, PROVIDER_ENVIRONMENTS_PATH),
    {
      bearerToken: accessToken,
      operationLabel: 'the published environment list',
      transport: requestOptions.transport,
    },
  );
  if (!body || typeof body !== 'object' || !Array.isArray((body as { environments?: unknown }).environments)) {
    throw invalidProviderResponseError(
      provider.provider_origin,
      'The Control Plane environment list is invalid.',
    );
  }
  return normalizeDesktopProviderEnvironmentList(body, { provider });
}

export async function requestDesktopOpenSession(
  provider: DesktopControlPlaneProvider,
  accessToken: string,
  envPublicID: string,
  requestOptions: ProviderClientRequestOptions = {},
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
      operationLabel: 'the desktop open session',
      transport: requestOptions.transport,
    },
  );
  return normalizeProviderOpenSessionResponse(
    provider.provider_origin,
    body,
    'The Control Plane desktop open session response is invalid.',
  );
}

export function providerBootstrapExchangeURL(providerOrigin: string): string {
  return providerRequestURL(providerOrigin, PROVIDER_BOOTSTRAP_EXCHANGE_PATH);
}
