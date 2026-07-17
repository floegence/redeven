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

  it('keeps one recovery snapshot while probing offline and reconnecting online', async () => {
    vi.useFakeTimers();
    const probeAvailability = vi.fn()
      .mockResolvedValueOnce({ status: 'offline', access: 'unknown' })
      .mockResolvedValueOnce({ status: 'online', access: 'ready' });
    const reconnect = vi.fn(async () => undefined);

    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        desktopTransport: () => null,
        probeAvailability,
        reconnect,
        requestDesktopRecoveryNow: async () => false,
      });
      return disposeRoot;
    });

    controller.activateWaiting(OFFLINE_FAILURE);
    expect(controller.snapshot()).toMatchObject({
      state: 'recovering',
      phase: 'runtime_probe',
      runtime_probe_attempt_count: 0,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await flushAsync();
    expect(probeAvailability).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toMatchObject({
      availability_status: 'offline',
      runtime_probe_attempt_count: 1,
    });
    expect(reconnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    await flushAsync();
    expect(probeAvailability).toHaveBeenCalledTimes(2);
    expect(controller.snapshot()).toMatchObject({
      phase: 'protocol_connect',
      availability_status: 'online',
      runtime_probe_attempt_count: 2,
    });
    expect(reconnect).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('pauses runtime probes until Desktop transport recovery completes', async () => {
    vi.useFakeTimers();
    const [desktopTransport, setDesktopTransport] = createSignal<DesktopTransportRecoverySnapshot>({
      generation: 1,
      revision: 1,
      phase: 'waiting' as const,
      attempt_count: 0,
      started_at_unix_ms: 100,
      next_attempt_at_unix_ms: 200,
      actions: ['retry_now' as const],
    });
    const probeAvailability = vi.fn().mockResolvedValue({ status: 'online', access: 'ready' });
    const reconnect = vi.fn(async () => undefined);
    const requestDesktopRecoveryNow = vi.fn(async () => true);

    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        desktopTransport,
        probeAvailability,
        reconnect,
        requestDesktopRecoveryNow,
      });
      return disposeRoot;
    });
    await flushAsync();

    expect(controller.snapshot()).toMatchObject({ state: 'recovering', phase: 'desktop_transport' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(probeAvailability).not.toHaveBeenCalled();
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
    expect(probeAvailability).toHaveBeenCalledTimes(1);
    expect(reconnect).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('counts exact Flowersec reconnect diagnostics and holds success before returning idle', async () => {
    vi.useFakeTimers();
    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        desktopTransport: () => null,
        probeAvailability: async () => ({ status: 'online', access: 'ready' }),
        reconnect: async () => undefined,
        requestDesktopRecoveryNow: async () => false,
      });
      return disposeRoot;
    });

    controller.noteProtocolDiagnostic({ stage: 'reconnect', code: 'reconnect_attempt', result: 'retry', attempt_seq: 8 });
    controller.noteProtocolDiagnostic({ stage: 'reconnect', code: 'reconnect_attempt', result: 'retry', attempt_seq: 8 });
    controller.noteProtocolDiagnostic({ stage: 'reconnect', code: 'reconnect_retry_attempt', result: 'retry', attempt_seq: 9 });
    expect(controller.snapshot()).toMatchObject({
      state: 'recovering',
      phase: 'protocol_connect',
      protocol_attempt_count: 2,
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

  it('hands exhausted Flowersec fast reconnect into the outer runtime probe loop', async () => {
    vi.useFakeTimers();
    const probeAvailability = vi.fn().mockResolvedValue({ status: 'offline', access: 'unknown' });
    let controller!: RuntimeReconnectController;
    const dispose = createRoot((disposeRoot) => {
      controller = createRuntimeReconnectController({
        enabled: () => true,
        desktopTransport: () => null,
        probeAvailability,
        reconnect: async () => undefined,
        requestDesktopRecoveryNow: async () => false,
      });
      return disposeRoot;
    });

    controller.noteProtocolDiagnostic(
      { stage: 'reconnect', code: 'reconnect_exhausted', result: 'fail', attempt_seq: 12 },
      OFFLINE_FAILURE,
    );
    expect(controller.snapshot()).toMatchObject({ state: 'recovering', phase: 'runtime_probe' });
    await vi.advanceTimersByTimeAsync(2_000);
    await flushAsync();
    expect(probeAvailability).toHaveBeenCalledTimes(1);
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
        probeAvailability: async () => ({ status: 'unknown' }),
        reconnect: async () => undefined,
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
    dispose();
  });
});
