import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readRedevenCss(): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return fs.readFileSync(path.resolve(dir, './redeven.css'), 'utf8');
}

describe('Redeven Env App surface theme contract', () => {
  it('defines the root panel surface family and aliases shared card/popover tokens to it', () => {
    const src = readRedevenCss();

    expect(src).toContain('--redeven-surface-panel: rgb(246, 245, 244);');
    expect(src).toContain('--redeven-surface-panel-soft: #fafbfc;');
    expect(src).toContain('--redeven-surface-panel-elevated: #ffffff;');
    expect(src).toContain('--redeven-surface-panel-border: color-mix(in srgb, var(--border) 82%, white 18%);');
    expect(src).toContain('--card: var(--redeven-surface-panel);');
    expect(src).toContain('--popover: var(--redeven-surface-panel);');

    expect(src).toContain('--redeven-surface-panel: rgb(41, 44, 51);');
    expect(src).toContain('--redeven-surface-panel-soft: #353942;');
    expect(src).toContain('--redeven-surface-panel-elevated: #40454f;');
    expect(src).toContain('--redeven-surface-panel-border: color-mix(in srgb, var(--border) 82%, #616976 18%);');
  });

  it('keeps Flower on the shared panel surface family instead of private raw color literals', () => {
    const src = readRedevenCss();

    expect(src).toContain('--flower-chat-surface: var(--redeven-surface-panel);');
    expect(src).toContain('--flower-chat-surface-soft: var(--redeven-surface-panel-soft);');
    expect(src).toContain('--flower-chat-surface-elevated: var(--redeven-surface-panel-elevated);');
    expect(src).toContain('--flower-chat-surface-border: var(--redeven-surface-panel-border);');
    expect(src).not.toContain('--flower-chat-surface: rgb(246, 245, 244);');
    expect(src).not.toContain('--flower-chat-surface: rgb(41, 44, 51);');
    expect(src.match(/rgb\(246, 245, 244\)/g)?.length ?? 0).toBe(1);
    expect(src.match(/rgb\(41, 44, 51\)/g)?.length ?? 0).toBe(1);
  });
});
