import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  classifyReconnectFailure,
  createRuntimeReconnectController,
  type ReconnectFailure,
  type RuntimeReconnectController,
} from './createRuntimeReconnectController';
import type { DesktopTransportRecoverySnapshot } from '../services/desktopSessionContext';

const OFFLINE_FAILURE: ReconnectFailure = {
  code: 'runtime_offline',
  retryable: true,
  technical_detail: '',
};

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0);
  }
}

describe('classifyReconnectFailure', () => {
  it('classifies only structured codes and HTTP status', () => {
    expect(classifyReconnectFailure({ code: 'AGENT_OFFLINE', message: 'opaque detail' })).toMatchObject({
      code: 'runtime_offline',
      retryable: true,
    });
    expect(classifyReconnectFailure({ code: 'AGENT_UNAVAILABLE', message: 'opaque detail' })).toMatchObject({
      code: 'runtime_unavailable',
      retryable: true,
    });
    expect(classifyReconnectFailure({ status: 401, message: 'opaque detail' })).toMatchObject({
      code: 'authentication_failed',
      retryable: false,
    });
    expect(classifyReconnectFailure({ status: 502, message: 'HTTP 502' })).toMatchObject({
      code: 'runtime_unavailable',
      http_status: 502,
    });
  });

  it('does not infer authentication or missing context from error text', () => {
    expect(classifyReconnectFailure(new Error('invalid resume token'))).toMatchObject({
      code: 'transport_unavailable',
      retryable: true,
    });
    expect(classifyReconnectFailure(new Error('missing env context'))).toMatchObject({
      code: 'transport_unavailable',
      retryable: true,
    });
  });
});

describe('createRuntimeReconnectController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('projects Flowersec waiting state without scheduling product retries', async () => {
    const retryProtocolNow = vi.fn(() => true);

    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        desktopTransport: () => null,
        retryProtocolNow,
        requestDesktopRecoveryNow: async () => false,
      });
      return disposeRoot;
    });

    controller.activateWaiting(OFFLINE_FAILURE, { attempt: 4, terminal: false, nextRetryAtUnixMs: 12_345 });
    expect(controller.snapshot()).toMatchObject({
      state: 'recovering',
      phase: 'protocol_connect',
      runtime_probe_attempt_count: 0,
      protocol_attempt_count: 4,
      next_retry_at_unix_ms: 12_345,
    });
    await controller.requestImmediateRetry();
    expect(retryProtocolNow).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('keeps Desktop recovery separate and nudges the same protocol controller when ready', async () => {
    const [desktopTransport, setDesktopTransport] = createSignal<DesktopTransportRecoverySnapshot>({
      generation: 1,
      revision: 1,
      phase: 'waiting' as const,
      attempt_count: 0,
      started_at_unix_ms: 100,
      next_attempt_at_unix_ms: 200,
      actions: ['retry_now' as const],
    });
    const retryProtocolNow = vi.fn(() => true);
    const requestDesktopRecoveryNow = vi.fn(async () => true);

    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        desktopTransport,
        retryProtocolNow,
        requestDesktopRecoveryNow,
      });
      return disposeRoot;
    });
    await flushAsync();

    expect(controller.snapshot()).toMatchObject({ state: 'recovering', phase: 'desktop_transport' });
    await controller.requestImmediateRetry();
    expect(requestDesktopRecoveryNow).toHaveBeenCalledTimes(1);

    setDesktopTransport({
      generation: 1,
      revision: 2,
      phase: 'ready',
      attempt_count: 1,
      started_at_unix_ms: 100,
      recovered_at_unix_ms: 220,
      actions: [],
    });
    await flushAsync();
    expect(retryProtocolNow).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('uses Flowersec attempt ordinals and holds success before returning idle', async () => {
    vi.useFakeTimers();
    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        desktopTransport: () => null,
        retryProtocolNow: () => true,
        requestDesktopRecoveryNow: async () => false,
      });
      return disposeRoot;
    });

    controller.activateWaiting(OFFLINE_FAILURE, { attempt: 8, terminal: false });
    controller.noteProtocolConnecting(9);
    expect(controller.snapshot()).toMatchObject({
      state: 'recovering',
      phase: 'protocol_connect',
      protocol_attempt_count: 9,
    });

    controller.noteProtocolConnected();
    controller.noteSecureSession('ready');
    expect(controller.snapshot()).toMatchObject({ state: 'succeeded', phase: 'completed' });
    await vi.advanceTimersByTimeAsync(1_499);
    expect(controller.snapshot().state).toBe('succeeded');
    await vi.advanceTimersByTimeAsync(1);
    expect(controller.snapshot()).toMatchObject({ state: 'idle', generation: 1 });
    dispose();
  });

  it('accepts a successful manual access regrant after an authentication failure', () => {
    vi.useFakeTimers();
    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        desktopTransport: () => null,
        retryProtocolNow: () => true,
        requestDesktopRecoveryNow: async () => false,
      });
      return disposeRoot;
    });

    controller.activateWaiting({
      code: 'authentication_failed',
      retryable: false,
      technical_detail: 'The access grant expired.',
    }, { attempt: 1, terminal: true });
    expect(controller.snapshot()).toMatchObject({ state: 'failed', secure_session: 'failed' });

    controller.noteProtocolConnected();
    controller.noteSecureSession('ready');
    expect(controller.snapshot()).toMatchObject({ state: 'succeeded', phase: 'completed' });
    dispose();
  });

  it('keeps terminal Flowersec failures terminal without an outer retry loop', async () => {
    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        desktopTransport: () => null,
        retryProtocolNow: () => true,
        requestDesktopRecoveryNow: async () => false,
      });
      return disposeRoot;
    });

    controller.activateWaiting(OFFLINE_FAILURE, { attempt: 12, terminal: true });
    expect(controller.snapshot()).toMatchObject({ state: 'failed', phase: 'failed' });
    dispose();
  });

  it('keeps a terminal Desktop failure as the final snapshot', async () => {
    const [desktopTransport] = createSignal({
      generation: 3,
      revision: 7,
      phase: 'failed' as const,
      attempt_count: 2,
      started_at_unix_ms: 100,
      failure: {
        code: 'process_identity_changed' as const,
        error_name: 'RuntimePlacementBridgeIdentityChangedError',
        technical_detail: 'Runtime identity changed.',
      },
      actions: ['open_connection_center' as const],
    });
    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        desktopTransport,
        retryProtocolNow: () => true,
        requestDesktopRecoveryNow: async () => false,
      });
      return disposeRoot;
    });
    await flushAsync();

    expect(controller.snapshot()).toMatchObject({
      state: 'failed',
      phase: 'failed',
      desktop_transport: { phase: 'failed', attempt_count: 2 },
      failure: { error_code: 'process_identity_changed' },
    });
    const terminalSnapshot = controller.snapshot();
    controller.noteProtocolConnected();
    controller.noteSecureSession('ready');
    expect(controller.snapshot()).toBe(terminalSnapshot);
    dispose();
  });

  it('ignores late connected and secure-ready events after missing environment context', () => {
    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        desktopTransport: () => null,
        retryProtocolNow: () => true,
        requestDesktopRecoveryNow: async () => false,
      });
      return disposeRoot;
    });

    controller.activateWaiting({
      code: 'missing_environment_context',
      retryable: false,
      technical_detail: 'Environment context is unavailable.',
      error_code: 'MISSING_ENV_CONTEXT',
    }, { attempt: 1, terminal: true });
    const terminalSnapshot = controller.snapshot();
    expect(terminalSnapshot).toMatchObject({
      state: 'failed',
      phase: 'failed',
      failure: { code: 'missing_environment_context' },
    });

    controller.noteProtocolConnected();
    controller.noteSecureSession('ready');
    expect(controller.snapshot()).toBe(terminalSnapshot);
    dispose();
  });
});
