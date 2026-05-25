import type { DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';
import { desktopWelcomeSnapshotIsAtLeastGeneration } from '../shared/desktopLauncherIPC';

export class DesktopWelcomeSnapshotOrder {
  private snapshotRevision = 0;
  private snapshotGeneration = 0;

  reserveGeneration(): number {
    this.snapshotGeneration += 1;
    return this.snapshotGeneration;
  }

  shouldEmitGeneration(snapshotGeneration: number): boolean {
    return desktopWelcomeSnapshotIsAtLeastGeneration(
      { snapshot_generation: snapshotGeneration },
      this.snapshotGeneration,
    );
  }

  stamp(
    snapshot: DesktopWelcomeSnapshot,
    snapshotGeneration = this.reserveGeneration(),
  ): DesktopWelcomeSnapshot {
    this.snapshotRevision += 1;
    return {
      ...snapshot,
      snapshot_revision: this.snapshotRevision,
      snapshot_generation: snapshotGeneration,
    };
  }
}
