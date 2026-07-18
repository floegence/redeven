import { describe, expect, it } from 'vitest';

import {
  allowLoopbackControlplaneHTTP,
  resolveLocalTransportSecurityPolicy,
} from './localTransportSecurity';

describe('resolveLocalTransportSecurityPolicy', () => {
  it.each(['localhost', '127.0.0.1', '127.42.0.9', '[::1]'])('uses the loopback policy for %s', (hostname) => {
    const resolved = resolveLocalTransportSecurityPolicy(hostname);
    expect(resolved).toMatchObject({ loopback: true, network: false, error: '' });
    expect(resolved.policy).toBe('allow_plaintext_for_loopback');
  });

  it('allows plaintext only for the exact network IP', async () => {
    const resolved = resolveLocalTransportSecurityPolicy('192.168.1.20');
    expect(resolved).toMatchObject({ loopback: false, network: true, error: '' });
    expect(typeof resolved.policy).toBe('function');
    const policy = resolved.policy as Exclude<typeof resolved.policy, string | null>;
    await expect(Promise.resolve(policy({ path: 'direct', scheme: 'ws', host: '192.168.1.20', runtime: 'browser' }))).resolves.toBe(true);
    await expect(Promise.resolve(policy({ path: 'direct', scheme: 'ws', host: '192.168.1.21', runtime: 'browser' }))).resolves.toBe(false);
    await expect(Promise.resolve(policy({ path: 'direct', scheme: 'wss', host: 'example.com', runtime: 'browser' }))).resolves.toBe(true);
  });

  it.each(['example.com', '0.0.0.0', '::', '::ffff:127.0.0.1'])('fails closed for invalid network hostname %s', (hostname) => {
    const resolved = resolveLocalTransportSecurityPolicy(hostname);
    expect(resolved.policy).toBeNull();
    expect(resolved.loopback).toBe(false);
    expect(resolved.network).toBe(false);
    expect(resolved.error).not.toBe('');
  });
});

describe('allowLoopbackControlplaneHTTP', () => {
  it('allows only HTTP pages whose transport resolution is canonical loopback', () => {
    const loopback = resolveLocalTransportSecurityPolicy('127.0.0.1');
    const network = resolveLocalTransportSecurityPolicy('192.168.1.20');
    const invalid = resolveLocalTransportSecurityPolicy('example.com');

    expect(allowLoopbackControlplaneHTTP('http:', loopback)).toBe(true);
    expect(allowLoopbackControlplaneHTTP('https:', loopback)).toBe(false);
    expect(allowLoopbackControlplaneHTTP('http:', network)).toBe(false);
    expect(allowLoopbackControlplaneHTTP('http:', invalid)).toBe(false);
  });
});
