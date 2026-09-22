import { readFileSync } from 'node:fs';
import { builtInShellThemePresets } from '../shared/floeThemeMetadata';
import type { DesktopThemeSnapshot } from '../shared/desktopTheme';

const windowStatusCSS = readFileSync(require.resolve('@floegence/floe-webapp-core/window-status.css'), 'utf8');
const progressCSS = readFileSync(require.resolve('@floegence/floe-webapp-core/progress-shimmer.css'), 'utf8');

/** Product-owned documents consume the published theme and layout without a renderer or network. */
export function windowStatusDocumentStyleText(theme: DesktopThemeSnapshot): string {
  const preset = builtInShellThemePresets.find((entry) => entry.name === theme.activeShellTheme);
  if (!preset) throw new Error(`Unknown window status theme: ${theme.activeShellTheme}`);
  const tokens = Object.entries(preset.semanticTokens ?? {}).map(([name, value]) => `${name}: ${value};`).join('\n');
  return `${windowStatusCSS}\n${progressCSS}
    :root { ${tokens}
      --surface: ${theme.semantic.surface};
      color-scheme: ${theme.resolvedTheme};
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-height: 100%; margin: 0; background: var(--background); color: var(--foreground); }
    code { font: inherit; overflow-wrap: anywhere; }
  `;
}
