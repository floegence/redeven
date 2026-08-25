export type LocalTransportSecurityResolution = Readonly<{
  policy: true | null;
  loopback: boolean;
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

function hostnameIsNumericLoopback(hostname: string): boolean {
  return hostname === '::1' || (hostname !== 'localhost' && hostnameIsLoopback(hostname));
}

export function resolveLocalTransportSecurityPolicy(
  protocol: string,
  rawHostname: string,
  documentTransport?: string,
): LocalTransportSecurityResolution {
	const hostname = normalizeHostname(rawHostname);
	const loopback = hostnameIsLoopback(hostname);
	const normalizedProtocol = String(protocol).trim().toLowerCase();
	if (normalizedProtocol === 'https:') {
		return { policy: true, loopback, network: !loopback, error: '' };
	}
	if (
		normalizedProtocol === 'http:'
		&& documentTransport === 'desktop_private_bridge_v1'
		&& hostnameIsNumericLoopback(hostname)
	) {
		return { policy: true, loopback: true, network: false, error: '' };
	}
	return {
		policy: null,
		loopback,
		network: !loopback,
		error: 'Redeven Local UI requires trusted HTTPS and Flowersec WSS.',
	};
}
