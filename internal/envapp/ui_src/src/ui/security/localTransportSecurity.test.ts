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

	it.each(['127.0.0.1', '127.42.0.9', '[::1]'])('accepts numeric private Desktop bridge host %s', (hostname) => {
		const resolved = resolveLocalTransportSecurityPolicy(
			'http:',
			hostname,
			'desktop_private_bridge_v1',
		);
		expect(resolved).toEqual({ policy: true, loopback: true, network: false, error: '' });
	});

	it.each(['localhost', '192.168.1.20'])('rejects private Desktop bridge marker on host %s', (hostname) => {
		expect(resolveLocalTransportSecurityPolicy(
			'http:',
			hostname,
			'desktop_private_bridge_v1',
		).policy).toBeNull();
	});

	it('rejects malformed Desktop bridge provenance', () => {
		expect(resolveLocalTransportSecurityPolicy('http:', '127.0.0.1', 'desktop_private_bridge_v2').policy).toBeNull();
	});
});
