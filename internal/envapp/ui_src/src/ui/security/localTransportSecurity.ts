import {
  AllowPlaintextForLoopback,
  createNetworkPlaintextPolicy,
  PlaintextRiskAcceptance,
  type TransportSecurityPolicy,
} from '@floegence/flowersec-core';

export type LocalTransportSecurityResolution = Readonly<{
  policy: TransportSecurityPolicy | null;
  network: boolean;
  error: string;
}>;

function normalizeHostname(raw: string): string {
  return String(raw ?? '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
}

function hostnameIsLoopback(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '::1') return true;
  const parts = hostname.split('.');
  return parts.length === 4
    && parts.every((part) => /^(0|[1-9][0-9]*)$/.test(part) && Number(part) <= 255)
    && Number(parts[0]) === 127;
}

export function resolveLocalTransportSecurityPolicy(rawHostname: string): LocalTransportSecurityResolution {
  const hostname = normalizeHostname(rawHostname);
  if (hostnameIsLoopback(hostname)) {
    return { policy: AllowPlaintextForLoopback, network: false, error: '' };
  }
  try {
    return {
      policy: createNetworkPlaintextPolicy({
        allowedHosts: [hostname],
        riskAcceptance: PlaintextRiskAcceptance.acceptPreE2ECredentialExposure,
      }),
      network: true,
      error: '',
    };
  } catch (error) {
    return {
      policy: null,
      network: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
