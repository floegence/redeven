import { describe, expect, it } from 'vitest';

import type { DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';
import { DesktopWelcomeSnapshotOrder } from './desktopWelcomeSnapshotOrder';

describe('DesktopWelcomeSnapshotOrder', () => {
  it('reserves generation before async snapshot build and rejects stale emissions', () => {
    const order = new DesktopWelcomeSnapshotOrder();
    const olderGeneration = order.reserveGeneration();
    const newerGeneration = order.reserveGeneration();

    expect(order.shouldEmitGeneration(olderGeneration)).toBe(false);
    expect(order.shouldEmitGeneration(newerGeneration)).toBe(true);

    const newerSnapshot = order.stamp({} as DesktopWelcomeSnapshot, newerGeneration);
    const implicitSnapshot = order.stamp({} as DesktopWelcomeSnapshot);

    expect(newerSnapshot).toMatchObject({
      snapshot_generation: newerGeneration,
      snapshot_revision: 1,
    });
    expect(implicitSnapshot.snapshot_generation).toBeGreaterThan(newerGeneration);
    expect(implicitSnapshot.snapshot_revision).toBe(2);
  });

  it('keeps a slow older async build from overwriting a newer terminal snapshot', async () => {
    const order = new DesktopWelcomeSnapshotOrder();
    const emitted: DesktopWelcomeSnapshot[] = [];

    const buildAndMaybeEmit = async (
      snapshotGeneration: number,
      build: Promise<DesktopWelcomeSnapshot>,
    ) => {
      const snapshot = await build;
      if (order.shouldEmitGeneration(snapshotGeneration)) {
        emitted.push(order.stamp(snapshot, snapshotGeneration));
      }
    };

    let finishOlderBuild: ((snapshot: DesktopWelcomeSnapshot) => void) | undefined;
    const olderBuild = new Promise<DesktopWelcomeSnapshot>((resolve) => {
      finishOlderBuild = resolve;
    });
    const olderGeneration = order.reserveGeneration();
    const olderTask = buildAndMaybeEmit(
      olderGeneration,
      olderBuild,
    );

    const newerGeneration = order.reserveGeneration();
    await buildAndMaybeEmit(
      newerGeneration,
      Promise.resolve(snapshotWithProgressTitle('Open failed')),
    );
    finishOlderBuild?.(snapshotWithProgressTitle('Opening environment'));
    await olderTask;

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      snapshot_generation: newerGeneration,
      snapshot_revision: 1,
      action_progress: [{ title: 'Open failed' }],
    });
  });
});

function snapshotWithProgressTitle(title: string): DesktopWelcomeSnapshot {
  return {
    action_progress: [{ title }],
  } as unknown as DesktopWelcomeSnapshot;
}
