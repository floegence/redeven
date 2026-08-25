import { describe, expect, it } from 'vitest';

import {
	resolveLocalTransportSecurityPolicy,
} from './localTransportSecurity';

describe('resolveLocalTransportSecurityPolicy', () => {
	it.each(['localhost', '127.0.0.1', '127.42.0.9', '[::1]'])('uses trusted TLS for loopback host %s', (hostname) => {
		const resolved = resolveLocalTransportSecurityPolicy('https:', hostname);
		expect(resolved).toMatchObject({ loopback: true, network: false, error: '' });
		expect(resolved.policy).toBe(true);
	});

	it('uses trusted TLS for a network host', () => {
		const resolved = resolveLocalTransportSecurityPolicy('https:', '192.168.1.20');
		expect(resolved).toMatchObject({ loopback: false, network: true, policy: true, error: '' });
	});

	it.each(['localhost', '127.0.0.1', '192.168.1.20'])('fails closed for plaintext host %s', (hostname) => {
		const resolved = resolveLocalTransportSecurityPolicy('http:', hostname);
		expect(resolved.policy).toBeNull();
		expect(resolved.error).not.toBe('');
	});
});
