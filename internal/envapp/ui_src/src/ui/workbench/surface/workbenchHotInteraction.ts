export const FLOE_HOT_INTERACTION_ATTR = 'data-floe-hot-interaction';

export type WorkbenchHotInteractionKind = 'drag' | 'resize';

export interface StartWorkbenchHotInteractionOptions {
  kind: WorkbenchHotInteractionKind;
  cursor: string;
  lockUserSelect?: boolean;
}

interface ActiveInteraction {
  token: number;
  kind: WorkbenchHotInteractionKind;
  cursor: string;
  lockUserSelect: boolean;
}

const activeInteractions: ActiveInteraction[] = [];
let nextInteractionToken = 0;
let previousBodyCursor: string | null = null;
let previousBodyUserSelect: string | null = null;

function syncRootAttribute(): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const activeKinds = [...new Set(activeInteractions.map((interaction) => interaction.kind))].sort();
  if (activeKinds.length === 0) {
    root.removeAttribute(FLOE_HOT_INTERACTION_ATTR);
    return;
  }

  root.setAttribute(FLOE_HOT_INTERACTION_ATTR, activeKinds.join(' '));
}

function syncBodyStyle(): void {
  if (typeof document === 'undefined') return;

  const body = document.body;
  if (!body) return;

  if (activeInteractions.length === 0) {
    if (previousBodyCursor !== null) {
      body.style.cursor = previousBodyCursor;
      previousBodyCursor = null;
    } else {
      body.style.removeProperty('cursor');
    }

    if (previousBodyUserSelect !== null) {
      body.style.userSelect = previousBodyUserSelect;
      previousBodyUserSelect = null;
    } else {
      body.style.removeProperty('user-select');
    }
    return;
  }

  if (previousBodyCursor === null) {
    previousBodyCursor = body.style.cursor;
  }
  if (previousBodyUserSelect === null) {
    previousBodyUserSelect = body.style.userSelect;
  }

  const latestInteraction = activeInteractions[activeInteractions.length - 1];
  body.style.cursor = latestInteraction?.cursor ?? previousBodyCursor;
  if (activeInteractions.some((interaction) => interaction.lockUserSelect)) {
    body.style.userSelect = 'none';
  } else if (previousBodyUserSelect !== null) {
    body.style.userSelect = previousBodyUserSelect;
  }
}

export function startWorkbenchHotInteraction(
  options: StartWorkbenchHotInteractionOptions,
): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }

  const token = nextInteractionToken + 1;
  nextInteractionToken = token;

  activeInteractions.push({
    token,
    kind: options.kind,
    cursor: options.cursor,
    lockUserSelect: options.lockUserSelect !== false,
  });
  syncRootAttribute();
  syncBodyStyle();

  let active = true;
  return () => {
    if (!active) return;
    active = false;

    const index = activeInteractions.findIndex((interaction) => interaction.token === token);
    if (index >= 0) {
      activeInteractions.splice(index, 1);
    }
    syncRootAttribute();
    syncBodyStyle();
  };
}
