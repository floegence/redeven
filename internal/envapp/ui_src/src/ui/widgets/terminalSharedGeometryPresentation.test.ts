import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTerminalGeometryPresentationController } from './terminalSharedGeometryPresentation';

describe('terminal shared geometry presentation', () => {
  afterEach(() => vi.useRealTimers());

  it('publishes only after acknowledged geometry crosses the renderer boundary', () => {
    vi.useFakeTimers();
    const updates: unknown[] = [];
    const controller = createTerminalGeometryPresentationController({
      onPresentation: value => updates.push(value),
    });
    const lifecycleEpoch = controller.beginLifecycle();
    const rendererEpoch = controller.beginRenderer();
    controller.setEligible(true);
    controller.observeLocal({ cols: 120, rows: 40 });
    const effective = controller.acknowledgeAttach({
      lifecycleEpoch,
      rendererEpoch,
      requestEpoch: controller.getState().requestEpoch,
      requested: { cols: 120, rows: 40 },
      runtimeAttachGeneration: 7,
      effective: {
        generation: 3,
        presentationSequence: 12,
        cols: 80,
        rows: 24,
      },
    });
    expect(effective).not.toBeNull();

    vi.advanceTimersByTime(500);
    expect(controller.getState().presentation).toBeNull();

    controller.noteAppliedEffective({ ...effective!, rendererEpoch });
    vi.advanceTimersByTime(349);
    expect(controller.getState().presentation).toBeNull();
    vi.advanceTimersByTime(1);
    expect(controller.getState().presentation).toMatchObject({
      local: { cols: 120, rows: 40 },
      effective: { cols: 80, rows: 24 },
    });
    expect(updates.at(-1)).toMatchObject({ effective: { generation: 3 } });
  });

  it('hides synchronously for a geometry-changing resize and rejects its stale result', () => {
    vi.useFakeTimers();
    const controller = createTerminalGeometryPresentationController({ onPresentation: () => undefined });
    const lifecycleEpoch = controller.beginLifecycle();
    const rendererEpoch = controller.beginRenderer();
    controller.setEligible(true);
    controller.observeLocal({ cols: 120, rows: 40 });
    const initial = controller.acknowledgeAttach({
      lifecycleEpoch,
      rendererEpoch,
      requestEpoch: controller.getState().requestEpoch,
      requested: { cols: 120, rows: 40 },
      runtimeAttachGeneration: 1,
      effective: { generation: 1, presentationSequence: 0, cols: 80, rows: 24 },
    })!;
    controller.noteAppliedEffective({ ...initial, rendererEpoch });
    vi.advanceTimersByTime(350);
    expect(controller.getState().presentation).not.toBeNull();

    const stale = controller.beginResize({ cols: 100, rows: 30 })!;
    expect(controller.getState().presentation).toBeNull();
    const current = controller.beginResize({ cols: 90, rows: 28 })!;
    expect(controller.acknowledgeResize(stale, {
      runtimeAttachGeneration: 1,
      requested: stale.requested,
      effective: { generation: 2, presentationSequence: 1, cols: 80, rows: 24 },
    })).toBeNull();
    expect(controller.acknowledgeResize(current, {
      runtimeAttachGeneration: 1,
      requested: current.requested,
      effective: { generation: 3, presentationSequence: 2, cols: 80, rows: 24 },
    })).not.toBeNull();
  });

  it('keeps a confirmed same-size reassertion stable and invalidates it on current failure', () => {
    vi.useFakeTimers();
    const controller = createTerminalGeometryPresentationController({ onPresentation: () => undefined });
    const lifecycleEpoch = controller.beginLifecycle();
    const rendererEpoch = controller.beginRenderer();
    controller.setEligible(true);
    controller.observeLocal({ cols: 120, rows: 40 });
    const effective = controller.acknowledgeAttach({
      lifecycleEpoch,
      rendererEpoch,
      requestEpoch: controller.getState().requestEpoch,
      requested: { cols: 120, rows: 40 },
      runtimeAttachGeneration: 1,
      effective: { generation: 1, presentationSequence: 0, cols: 80, rows: 24 },
    })!;
    controller.noteAppliedEffective({ ...effective, rendererEpoch });
    vi.advanceTimersByTime(350);

    const reassertion = controller.beginResize({ cols: 120, rows: 40 })!;
    expect(reassertion.reassertion).toBe(true);
    expect(controller.getState().presentation).not.toBeNull();
    controller.failResize(reassertion);
    expect(controller.getState().presentation).toBeNull();
  });

  it('updates a future candidate atomically after it is applied and delays confirmed equality removal', () => {
    vi.useFakeTimers();
    const controller = createTerminalGeometryPresentationController({ onPresentation: () => undefined });
    const lifecycleEpoch = controller.beginLifecycle();
    const rendererEpoch = controller.beginRenderer();
    controller.setEligible(true);
    controller.observeLocal({ cols: 120, rows: 40 });
    const initial = controller.acknowledgeAttach({
      lifecycleEpoch,
      rendererEpoch,
      requestEpoch: controller.getState().requestEpoch,
      requested: { cols: 120, rows: 40 },
      runtimeAttachGeneration: 1,
      effective: { generation: 1, presentationSequence: 0, cols: 80, rows: 24 },
    })!;
    controller.noteAppliedEffective({ ...initial, rendererEpoch });
    vi.advanceTimersByTime(350);

    const equal = { lifecycleEpoch, generation: 2, presentationSequence: 5, cols: 120, rows: 40 };
    controller.noteKnownEffective(equal);
    expect(controller.getState().presentation?.effective.cols).toBe(80);
    controller.noteAppliedEffective({ ...equal, rendererEpoch });
    expect(controller.getState().presentation?.effective.cols).toBe(80);
    vi.advanceTimersByTime(249);
    expect(controller.getState().presentation?.effective.cols).toBe(80);
    vi.advanceTimersByTime(1);
    expect(controller.getState().presentation).toBeNull();
  });

  it('requires same-generation geometry to be applied again on a new renderer', () => {
    vi.useFakeTimers();
    const controller = createTerminalGeometryPresentationController({ onPresentation: () => undefined });
    const lifecycleEpoch = controller.beginLifecycle();
    const firstRenderer = controller.beginRenderer();
    controller.setEligible(true);
    controller.observeLocal({ cols: 120, rows: 40 });
    const effective = controller.acknowledgeAttach({
      lifecycleEpoch,
      rendererEpoch: firstRenderer,
      requestEpoch: controller.getState().requestEpoch,
      requested: { cols: 120, rows: 40 },
      runtimeAttachGeneration: 2,
      effective: { generation: 4, presentationSequence: 0, cols: 80, rows: 24 },
    })!;
    controller.noteAppliedEffective({ ...effective, rendererEpoch: firstRenderer });
    vi.advanceTimersByTime(350);
    expect(controller.getState().presentation).not.toBeNull();

    controller.endRenderer(firstRenderer);
    const secondRenderer = controller.beginRenderer();
    expect(controller.getState().presentation).toBeNull();
    controller.noteAppliedEffective({ ...effective, rendererEpoch: secondRenderer });
    vi.advanceTimersByTime(350);
    expect(controller.getState().presentation).toBeNull();
  });

  it('ignores a close event from an older attachment generation', () => {
    vi.useFakeTimers();
    const controller = createTerminalGeometryPresentationController({ onPresentation: () => undefined });
    const lifecycleEpoch = controller.beginLifecycle();
    const rendererEpoch = controller.beginRenderer();
    controller.setEligible(true);
    controller.observeLocal({ cols: 120, rows: 40 });
    const effective = controller.acknowledgeAttach({
      lifecycleEpoch,
      rendererEpoch,
      requestEpoch: controller.getState().requestEpoch,
      requested: { cols: 120, rows: 40 },
      runtimeAttachGeneration: 9,
      effective: { generation: 1, presentationSequence: 0, cols: 80, rows: 24 },
    })!;
    controller.noteAppliedEffective({ ...effective, rendererEpoch });
    vi.advanceTimersByTime(350);
    controller.closeAttachment(8);
    expect(controller.getState().presentation).not.toBeNull();
    controller.closeAttachment(9);
    expect(controller.getState().presentation).toBeNull();
  });

  it('binds a valid attachment when the local request changes before acknowledgement', () => {
    const controller = createTerminalGeometryPresentationController({ onPresentation: () => undefined });
    const lifecycleEpoch = controller.beginLifecycle();
    const rendererEpoch = controller.beginRenderer();
    controller.observeLocal({ cols: 120, rows: 40 });
    const requestEpoch = controller.getState().requestEpoch;
    controller.observeLocal({ cols: 100, rows: 30 });

    const effective = controller.acknowledgeAttach({
      lifecycleEpoch,
      rendererEpoch,
      requestEpoch,
      requested: { cols: 120, rows: 40 },
      runtimeAttachGeneration: 5,
      effective: { generation: 1, presentationSequence: 0, cols: 80, rows: 24 },
    });

    expect(effective).toMatchObject({ cols: 80, rows: 24 });
    expect(controller.getState()).toMatchObject({
      observedLocal: { cols: 100, rows: 30 },
      acknowledgedLocal: null,
      geometryChangingResizePending: true,
    });
    expect(controller.beginResize({ cols: 100, rows: 30 })).not.toBeNull();
  });

  it('does not let older attach or resize acknowledgements regress a newer geometry event', () => {
    const controller = createTerminalGeometryPresentationController({ onPresentation: () => undefined });
    const lifecycleEpoch = controller.beginLifecycle();
    const rendererEpoch = controller.beginRenderer();
    controller.observeLocal({ cols: 120, rows: 40 });
    controller.noteKnownEffective({
      lifecycleEpoch,
      generation: 3,
      presentationSequence: 8,
      cols: 90,
      rows: 28,
    });
    const attached = controller.acknowledgeAttach({
      lifecycleEpoch,
      rendererEpoch,
      requestEpoch: controller.getState().requestEpoch,
      requested: { cols: 120, rows: 40 },
      runtimeAttachGeneration: 2,
      effective: { generation: 2, presentationSequence: 4, cols: 80, rows: 24 },
    });
    expect(attached).toMatchObject({ generation: 2, presentationSequence: 4, cols: 80, rows: 24 });

    const resize = controller.beginResize({ cols: 120, rows: 40 })!;
    controller.noteKnownEffective({
      lifecycleEpoch,
      generation: 4,
      presentationSequence: 10,
      cols: 88,
      rows: 27,
    });
    const acknowledged = controller.acknowledgeResize(resize, {
      runtimeAttachGeneration: 2,
      requested: { cols: 120, rows: 40 },
      effective: { generation: 3, presentationSequence: 9, cols: 90, rows: 28 },
    });
    expect(acknowledged).toMatchObject({ generation: 3, presentationSequence: 9, cols: 90, rows: 28 });
    expect(controller.getState().knownEffective).toMatchObject({ generation: 4, cols: 88, rows: 27 });
  });

  it('fails closed for conflicting dimensions within one geometry generation', () => {
    vi.useFakeTimers();
    const controller = createTerminalGeometryPresentationController({ onPresentation: () => undefined });
    const lifecycleEpoch = controller.beginLifecycle();
    const rendererEpoch = controller.beginRenderer();
    controller.setEligible(true);
    controller.observeLocal({ cols: 120, rows: 40 });
    const effective = controller.acknowledgeAttach({
      lifecycleEpoch,
      rendererEpoch,
      requestEpoch: controller.getState().requestEpoch,
      requested: { cols: 120, rows: 40 },
      runtimeAttachGeneration: 1,
      effective: { generation: 1, presentationSequence: 0, cols: 80, rows: 24 },
    })!;
    controller.noteAppliedEffective({ ...effective, rendererEpoch });
    vi.advanceTimersByTime(350);

    expect(controller.noteKnownEffective({
      lifecycleEpoch,
      generation: 1,
      presentationSequence: 1,
      cols: 81,
      rows: 24,
    })).toBe(false);
    expect(controller.getState().presentation).toBeNull();
    expect(controller.getState().acknowledgedLocal).toBeNull();
  });
});
