export const DESKTOP_WINDOW_CHROME_STYLE_ID = 'redeven-desktop-window-chrome';

export const DESKTOP_WINDOW_CHROME_DRAG_ROOT_SELECTORS = [
  "[data-floe-shell-slot='top-bar']",
  "[data-redeven-desktop-titlebar-drag-region='true']",
] as const;

export const DESKTOP_WINDOW_CHROME_NO_DRAG_ATTR = 'data-redeven-desktop-titlebar-no-drag';
export const DESKTOP_WINDOW_CHROME_NO_DRAG_SELECTOR = `[${DESKTOP_WINDOW_CHROME_NO_DRAG_ATTR}='true']`;

export const DESKTOP_WINDOW_CHROME_NO_DRAG_TARGET_SELECTORS = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  "[role='button']",
  DESKTOP_WINDOW_CHROME_NO_DRAG_SELECTOR,
] as const;

export type DesktopWindowChromeMode = 'hidden-inset' | 'overlay';

export type DesktopWindowControlsSide = 'left' | 'right';

export type DesktopWindowChromeSnapshot = Readonly<{
  mode: DesktopWindowChromeMode;
  controlsSide: DesktopWindowControlsSide;
  titleBarHeight: number;
  contentInsetStart: number;
  contentInsetEnd: number;
}>;

function normalizePositiveNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

export function normalizeDesktopWindowChromeSnapshot(value: unknown): DesktopWindowChromeSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopWindowChromeSnapshot>;
  const mode = candidate.mode === 'hidden-inset' || candidate.mode === 'overlay'
    ? candidate.mode
    : null;
  const controlsSide = candidate.controlsSide === 'left' || candidate.controlsSide === 'right'
    ? candidate.controlsSide
    : null;
  const titleBarHeight = normalizePositiveNumber(candidate.titleBarHeight);
  const contentInsetStart = normalizePositiveNumber(candidate.contentInsetStart);
  const contentInsetEnd = normalizePositiveNumber(candidate.contentInsetEnd);

  if (!mode || !controlsSide || titleBarHeight <= 0) {
    return null;
  }

  return {
    mode,
    controlsSide,
    titleBarHeight,
    contentInsetStart,
    contentInsetEnd,
  };
}

export function desktopWindowChromeCSSVariables(
  snapshot: DesktopWindowChromeSnapshot,
): Readonly<Record<string, string>> {
  const balanceInset = Math.max(snapshot.contentInsetStart, snapshot.contentInsetEnd);
  return {
    '--redeven-desktop-titlebar-height': `${snapshot.titleBarHeight}px`,
    '--redeven-desktop-titlebar-start-inset': `${snapshot.contentInsetStart}px`,
    '--redeven-desktop-titlebar-end-inset': `${snapshot.contentInsetEnd}px`,
    '--redeven-desktop-titlebar-balance-inset': `${balanceInset}px`,
  };
}

export function buildDesktopWindowChromeStyleText(
  snapshot: DesktopWindowChromeSnapshot,
): string {
  const chromeVars = desktopWindowChromeCSSVariables(snapshot);
  const declarations = Object.entries(chromeVars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  const topBarDragSelector = DESKTOP_WINDOW_CHROME_DRAG_ROOT_SELECTORS[0];
  const noDragSelectors = DESKTOP_WINDOW_CHROME_NO_DRAG_TARGET_SELECTORS
    .map((selector) => (
      selector.startsWith('[')
        ? selector
        : `${topBarDragSelector} ${selector}`
    ))
    .join(',\n');

  return `
:root {
${declarations}
}

${topBarDragSelector} {
  app-region: drag;
  user-select: none;
}

${topBarDragSelector} > div:first-child {
  padding-inline-start: calc(0.75rem + var(--redeven-desktop-titlebar-start-inset));
  padding-inline-end: calc(0.75rem + var(--redeven-desktop-titlebar-end-inset));
}

:root[data-redeven-desktop-window-chrome-mode='hidden-inset'][data-redeven-desktop-window-controls-side='left'] ${topBarDragSelector} > div:first-child {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.5rem minmax(0, 24rem) 4.5rem minmax(0, 1fr);
  align-items: center;
  column-gap: 0.5rem;
  padding-inline-start: calc(0.75rem + var(--redeven-desktop-titlebar-balance-inset));
  padding-inline-end: calc(0.75rem + var(--redeven-desktop-titlebar-balance-inset));
}

:root[data-redeven-desktop-window-chrome-mode='hidden-inset'][data-redeven-desktop-window-controls-side='left'] ${topBarDragSelector} > div:first-child > :first-child {
  grid-column: 2;
  min-width: 0;
  justify-self: end;
}

:root[data-redeven-desktop-window-chrome-mode='hidden-inset'][data-redeven-desktop-window-controls-side='left'] ${topBarDragSelector} > div:first-child > button:nth-child(2) {
  grid-column: 3;
  width: 100%;
  max-width: 100%;
  justify-self: center;
}

:root[data-redeven-desktop-window-chrome-mode='hidden-inset'][data-redeven-desktop-window-controls-side='left'] ${topBarDragSelector} > div:first-child > :last-child {
  grid-column: 4;
  min-width: 0;
  justify-self: start;
}

[data-redeven-desktop-window-titlebar='true'] {
  min-height: var(--redeven-desktop-titlebar-height, 40px);
}

[data-redeven-desktop-window-titlebar-content='true'] {
  min-height: var(--redeven-desktop-titlebar-height, 40px);
  padding-inline-start: calc(0.75rem + var(--redeven-desktop-titlebar-start-inset));
  padding-inline-end: calc(0.75rem + var(--redeven-desktop-titlebar-end-inset));
}

${noDragSelectors} {
  app-region: no-drag;
  user-select: auto;
}

[data-redeven-desktop-titlebar-drag-region='true'] {
  app-region: drag;
  user-select: none;
}
`;
}
