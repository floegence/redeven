// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { patchTerminalSelectionMouseUpBehavior, readTerminalSelectionText } from './terminalSelectionBehavior';

describe('terminalSelectionBehavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('patches mouseup handling to finish selection without synchronous selection extraction', () => {
    const originalMouseUpHandler = vi.fn();
    const stopAutoScroll = vi.fn();
    const fire = vi.fn();
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const addSpy = vi.spyOn(document, 'addEventListener');

    const core = {
      terminal: {
        selectionManager: {
          isSelecting: true,
          boundMouseUpHandler: originalMouseUpHandler,
          stopAutoScroll,
          selectionChangedEmitter: { fire },
        },
      },
    } as any;

    patchTerminalSelectionMouseUpBehavior(core);

    expect(removeSpy).toHaveBeenCalledWith('mouseup', originalMouseUpHandler);
    const patchedMouseUpHandler = core.terminal.selectionManager.boundMouseUpHandler;
    expect(addSpy).toHaveBeenCalledWith('mouseup', patchedMouseUpHandler);

    patchedMouseUpHandler(new MouseEvent('mouseup'));

    expect(core.terminal.selectionManager.isSelecting).toBe(false);
    expect(stopAutoScroll).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('does not patch the same selection manager twice', () => {
    const originalMouseUpHandler = vi.fn();
    const addSpy = vi.spyOn(document, 'addEventListener');

    const core = {
      terminal: {
        selectionManager: {
          isSelecting: false,
          boundMouseUpHandler: originalMouseUpHandler,
          selectionChangedEmitter: { fire: vi.fn() },
        },
      },
    } as any;

    patchTerminalSelectionMouseUpBehavior(core);
    patchTerminalSelectionMouseUpBehavior(core);

    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it('reads selection text safely from the terminal core', () => {
    expect(readTerminalSelectionText({
      getSelectionText: () => '  hello world  ',
    } as any)).toBe('hello world');

    expect(readTerminalSelectionText({
      getSelectionText: () => {
        throw new Error('boom');
      },
    } as any)).toBe('');
  });
});
