import {
  getThemeColors,
  type SemanticFrame,
  type SemanticTerminalPalette,
  type SemanticPresentation,
} from '@floegence/floeterm-terminal-web/semantic';
import {
  collectTerminalLinkTargets,
  type TerminalResolvedLinkTarget,
} from '../services/terminalLinkProvider';

export type SemanticTerminalAppearance = Readonly<{
  theme: Readonly<Record<string, string>>;
  fontSize: number;
  fontFamily: string;
}>;

export type SemanticTerminalCopyResult =
  | Readonly<{ copied: true; textLength: number; source: 'shortcut' | 'command' }>
  | Readonly<{ copied: false; reason: 'empty_selection' | 'clipboard_unavailable'; source: 'shortcut' | 'command' }>;

export type SemanticTerminalTouchScrollRuntime = Readonly<{
  isAlternateScreen(): boolean;
  getScrollbackLength(): number;
  scrollLines(lines: number): void;
  sendAlternateScreenInput(data: string): void;
}>;

export type SemanticTerminalSearchResult = Readonly<{
  resultIndex: number;
  resultCount: number;
}>;

export type SemanticTerminalLinkTarget =
  | Readonly<{ kind: 'external'; url: string }>
  | Readonly<{ kind: 'file'; target: TerminalResolvedLinkTarget }>;

type SemanticTerminalLinkPoint = Readonly<{
  clientX: number;
  clientY: number;
  bounds: Readonly<{ left: number; top: number; width: number; height: number }>;
  workingDirAbs: string;
  agentHomePathAbs?: string;
}>;

export type SemanticTerminalViewportHandle = Readonly<{
  activate(): Promise<void>;
  focus(options?: FocusOptions): void;
  forceResize(): void;
  setAppearance(appearance: SemanticTerminalAppearance): void;
  getDimensions(): Readonly<{ cols: number; rows: number }>;
  getTerminalInfo(): Readonly<{ rows: number; cols: number; bufferLength: number }>;
  readBufferLine(row: number, options?: Readonly<{ trimRight?: boolean }>): string;
  getVisibleScreenText(): string;
  getSelectionText(): string;
  hasSelection(): boolean;
  copySelection(source: 'shortcut' | 'command'): Promise<SemanticTerminalCopyResult>;
  getTouchScrollRuntime(): SemanticTerminalTouchScrollRuntime;
  setSearchResultsCallback(callback: ((result: SemanticTerminalSearchResult) => void) | null): void;
  clearSearch(): void;
  findNext(query: string): void;
  findPrevious(query: string): void;
  getPresentation(): SemanticPresentation | null;
}>;

const REQUIRED_PALETTE_KEYS = Object.freeze(
  Object.keys(getThemeColors('dark')) as (keyof SemanticTerminalPalette)[],
);

export function isSemanticTerminalPalette(
  colors: Readonly<Record<string, string>>,
): colors is SemanticTerminalPalette {
  return REQUIRED_PALETTE_KEYS.every((key) => typeof colors[key] === 'string' && colors[key].trim() !== '');
}

function terminalCellIndexAtPoint(
  frame: SemanticFrame,
  point: SemanticTerminalLinkPoint,
): Readonly<{ row: number; col: number }> | null {
  if (point.bounds.width <= 0 || point.bounds.height <= 0) return null;
  const x = point.clientX - point.bounds.left;
  const y = point.clientY - point.bounds.top;
  if (x < 0 || y < 0 || x >= point.bounds.width || y >= point.bounds.height) return null;
  return {
    col: Math.min(frame.width - 1, Math.floor((x / point.bounds.width) * frame.width)),
    row: Math.min(frame.height - 1, Math.floor((y / point.bounds.height) * frame.height)),
  };
}

function normalizeExternalTerminalURL(value: string | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function resolveSemanticTerminalLinkAtPoint(
  frame: SemanticFrame,
  point: SemanticTerminalLinkPoint,
): SemanticTerminalLinkTarget | null {
  const position = terminalCellIndexAtPoint(frame, point);
  if (!position) return null;
  const row = frame.rows[position.row];
  if (!row) return null;

  let cellIndex = position.col;
  while (cellIndex > 0 && (row.cells[cellIndex]?.width ?? 0) === 0) cellIndex -= 1;
  const externalURL = normalizeExternalTerminalURL(row.cells[cellIndex]?.hyperlink);
  if (externalURL) return { kind: 'external', url: externalURL };

  const lineText = row.cells.map((cell) => cell.text).join('');
  const clickedOffset = row.cells
    .slice(0, cellIndex)
    .reduce((offset, cell) => offset + cell.text.length, 0);
  const target = collectTerminalLinkTargets(lineText, {
    workingDirAbs: point.workingDirAbs,
    agentHomePathAbs: point.agentHomePathAbs,
  }).find((candidate) => {
    const start = lineText.indexOf(candidate.rawText);
    return start >= 0 && clickedOffset >= start && clickedOffset < start + candidate.rawText.length;
  });
  return target ? { kind: 'file', target } : null;
}
