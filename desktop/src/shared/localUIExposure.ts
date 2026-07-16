export type LocalUIExposure = Readonly<{
	scope: 'loopback' | 'network';
	transport: 'plaintext';
	password_required: boolean;
}>;

export function parseLocalUIExposure(value: unknown): LocalUIExposure {
	if (!value || typeof value !== 'object') {
		throw new Error('missing Local UI exposure');
	}
	const record = value as Record<string, unknown>;
	const scope = String(record.scope ?? '').trim();
	const transport = String(record.transport ?? '').trim();
	if (scope !== 'loopback' && scope !== 'network') {
		throw new Error('invalid Local UI exposure scope');
	}
	if (transport !== 'plaintext') {
		throw new Error('invalid Local UI exposure transport');
	}
	if (typeof record.password_required !== 'boolean') {
		throw new Error('invalid Local UI exposure password requirement');
	}
	if (scope === 'network' && record.password_required !== true) {
		throw new Error('network Local UI exposure requires password authentication');
	}
	return {
		scope,
		transport,
		password_required: record.password_required,
	};
}

export function networkLocalUIExposureActive(exposure: LocalUIExposure | null | undefined): boolean {
	return exposure?.scope === 'network' && exposure.transport === 'plaintext';
}
