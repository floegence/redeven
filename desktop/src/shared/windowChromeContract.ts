export const DESKTOP_WINDOW_CHROME_STYLE_ID = 'redeven-desktop-window-chrome';

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
  return {
    '--redeven-desktop-titlebar-height': `${snapshot.titleBarHeight}px`,
    '--redeven-desktop-titlebar-start-inset': `${snapshot.contentInsetStart}px`,
    '--redeven-desktop-titlebar-end-inset': `${snapshot.contentInsetEnd}px`,
  };
}

export function buildDesktopWindowChromeStyleText(
  snapshot: DesktopWindowChromeSnapshot,
): string {
  const chromeVars = desktopWindowChromeCSSVariables(snapshot);
  const declarations = Object.entries(chromeVars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');

  return `
:root {
${declarations}
}

[data-floe-shell-slot='top-bar'] {
  app-region: drag;
  user-select: none;
}

[data-floe-shell-slot='top-bar'] > div:first-child {
  padding-inline-start: calc(0.75rem + var(--redeven-desktop-titlebar-start-inset));
  padding-inline-end: calc(0.75rem + var(--redeven-desktop-titlebar-end-inset));
}

[data-redeven-desktop-window-titlebar='true'] {
  min-height: var(--redeven-desktop-titlebar-height, 40px);
}

[data-redeven-desktop-window-titlebar-content='true'] {
  min-height: var(--redeven-desktop-titlebar-height, 40px);
  padding-inline-start: calc(0.75rem + var(--redeven-desktop-titlebar-start-inset));
  padding-inline-end: calc(0.75rem + var(--redeven-desktop-titlebar-end-inset));
}

[data-floe-shell-slot='top-bar'] button,
[data-floe-shell-slot='top-bar'] a,
[data-floe-shell-slot='top-bar'] input,
[data-floe-shell-slot='top-bar'] textarea,
[data-floe-shell-slot='top-bar'] select,
[data-floe-shell-slot='top-bar'] [role='button'],
[data-redeven-desktop-titlebar-no-drag='true'] {
  app-region: no-drag;
  user-select: auto;
}

[data-redeven-desktop-titlebar-drag-region='true'] {
  app-region: drag;
  user-select: none;
}
`;
}
