import { REQUIRED_SHELL_THEME_TOKENS } from '@floegence/floe-webapp-core/themes';

export type BrowserDocumentTheme = Readonly<{
  tokens: Record<string, string>;
  dark: boolean;
  surfaceStyle: string;
  shellTheme: string;
  fontFamily: string;
}>;

const tokens = [...REQUIRED_SHELL_THEME_TOKENS, '--font-sans', '--radius'];
const chromeTokens = {
  '--floe-background': '--background', '--floe-foreground': '--foreground',
  '--floe-muted': '--muted-foreground', '--floe-line': '--border',
  '--floe-accent': '--primary', '--floe-surface': '--muted', '--floe-field': '--secondary',
};

/** The parent owns presentation; browser documents inherit its resolved theme. */
export function captureBrowserDocumentTheme(): BrowserDocumentTheme {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  return {
    tokens: Object.fromEntries(tokens.map(token => [token, style.getPropertyValue(token).trim()]).filter(([, value]) => value)),
    dark: root.classList.contains('dark'),
    surfaceStyle: root.getAttribute('data-floe-surface-style') ?? '',
    shellTheme: root.getAttribute('data-floe-shell-theme') ?? '',
    fontFamily: getComputedStyle(document.body).fontFamily,
  };
}

export function applyBrowserDocumentTheme(theme: BrowserDocumentTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme.dark);
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  root.style.fontFamily = theme.fontFamily;
  for (const [attribute, value] of [['data-floe-surface-style', theme.surfaceStyle], ['data-floe-shell-theme', theme.shellTheme]]) {
    if (value) root.setAttribute(attribute, value); else root.removeAttribute(attribute);
  }
  for (const token of tokens) {
    if (theme.tokens[token]) root.style.setProperty(token, theme.tokens[token]);
    else root.style.removeProperty(token);
  }
}

export function applyBrowserChromeTheme(element: HTMLElement): void {
  for (const [name, token] of Object.entries(chromeTokens)) element.style.setProperty(name, `var(${token})`);
}
