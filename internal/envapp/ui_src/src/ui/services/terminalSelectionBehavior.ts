import type { TerminalCore } from '@floegence/floeterm-terminal-web';

type GhosttySelectionManager = {
  isSelecting?: boolean;
  boundMouseUpHandler?: EventListener | null;
  stopAutoScroll?: () => void;
  selectionChangedEmitter?: {
    fire?: () => void;
  };
  __redevenSelectionMouseUpPatched?: boolean;
};

type GhosttyTerminalLike = {
  selectionManager?: GhosttySelectionManager | null;
};

function resolveSelectionManager(core: TerminalCore | null): GhosttySelectionManager | null {
  const terminal = (core as unknown as { terminal?: GhosttyTerminalLike | null } | null)?.terminal;
  const selectionManager = terminal?.selectionManager ?? null;
  if (!selectionManager || typeof selectionManager !== 'object') {
    return null;
  }
  return selectionManager;
}

export function readTerminalSelectionText(core: TerminalCore | null): string {
  try {
    return String(core?.getSelectionText?.() ?? '').trim();
  } catch {
    return '';
  }
}

export function patchTerminalSelectionMouseUpBehavior(core: TerminalCore | null): void {
  const selectionManager = resolveSelectionManager(core);
  if (!selectionManager || selectionManager.__redevenSelectionMouseUpPatched) {
    return;
  }

  selectionManager.__redevenSelectionMouseUpPatched = true;

  if (typeof document !== 'undefined' && selectionManager.boundMouseUpHandler) {
    document.removeEventListener('mouseup', selectionManager.boundMouseUpHandler);
  }

  const patchedMouseUpHandler: EventListener = () => {
    if (!selectionManager.isSelecting) {
      return;
    }
    selectionManager.isSelecting = false;
    selectionManager.stopAutoScroll?.();
    selectionManager.selectionChangedEmitter?.fire?.();
  };

  selectionManager.boundMouseUpHandler = patchedMouseUpHandler;

  if (typeof document !== 'undefined') {
    document.addEventListener('mouseup', patchedMouseUpHandler);
  }
}
