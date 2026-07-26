import '../index.css';
import './flower-feature.css';

import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

vi.mock('../../../../flower_ui/src/SubagentDetailWindow', () => ({
  SubagentDetailWindow: () => null,
}));

vi.mock('../../../../flower_ui/src/filePicker/FlowerWorkingDirPickerDialog', () => ({
  FlowerWorkingDirPickerDialog: () => null,
}));

import { FlowerSurface } from '../../../../flower_ui/src/FlowerSurface';
import { createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { adapter, waitFor } from './FlowerSurface.navigation.testHarness';

describe('Flower collapsed draft recovery browser interaction', () => {
  it('keeps the recovery action hittable and keyboard operable inside the 22px companion host', async () => {
    await page.viewport(800, 600);
    const coordinator = createFlowerComposerDraftCoordinator();
    await coordinator.open('thread-1', 'activity').acquire();
    const openCompanion = vi.fn();
    const runtime = document.createElement('div');
    Object.assign(runtime.style, {
      position: 'fixed',
      left: '24px',
      bottom: '24px',
      width: '320px',
      height: '22px',
      overflow: 'hidden',
    });
    document.body.append(runtime);
    const dispose = render(() => (
      <FlowerSurface
        adapter={adapter()}
        draftCoordinator={coordinator}
        surfaceInstanceID="workbench"
        notify={() => undefined}
        presentation="companion"
        companionOpen={false}
        companionRegionID="test-flower-companion"
        companionSummary={{
          visualText: '',
          accessibleText: 'Ready to ask Flower',
          priorityStatus: 'idle',
          running: false,
        }}
        engaged={false}
        transcriptVisible={false}
        onCompanionOpenRequest={openCompanion}
        focusThreadRequest={{ request_id: 'focus-recovery-browser', thread_id: 'thread-1' }}
      />
    ), runtime);

    try {
      await waitFor(() => Boolean(runtime.querySelector('[data-flower-companion-recovery="lease_conflict"]')));
      const recovery = runtime.querySelector('[data-flower-companion-recovery="lease_conflict"]') as HTMLButtonElement;
      const rect = recovery.getBoundingClientRect();
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(rect.height).toBeLessThanOrEqual(22);
      expect(getComputedStyle(recovery).cursor).toBe('pointer');
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      expect(recovery.contains(hit)).toBe(true);

      await userEvent.click(recovery);
      expect(openCompanion).toHaveBeenCalledTimes(1);
      recovery.focus();
      await userEvent.keyboard('{Enter}');
      expect(openCompanion).toHaveBeenCalledTimes(2);
      await userEvent.keyboard('{Space}');
      expect(openCompanion).toHaveBeenCalledTimes(3);
    } finally {
      dispose();
      runtime.remove();
    }
  });
});
