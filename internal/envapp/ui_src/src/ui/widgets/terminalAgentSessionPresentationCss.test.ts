import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../styles/redeven.css');

describe('terminal agent output presentation CSS', () => {
  it('uses waveform motion rather than the process spinner animation', () => {
    const css = fs.readFileSync(stylesPath, 'utf8');
    expect(css).toContain('.redeven-terminal-output-wave-bar');
    expect(css).toContain('animation: redeven-terminal-output-wave 1.1s ease-in-out infinite;');
    expect(css).not.toMatch(/\.redeven-terminal-output-wave-bar\s*\{[^}]*animate-spin/su);
  });

  it('stops waveform motion for reduced motion and keeps forced-color shape contrast', () => {
    const css = fs.readFileSync(stylesPath, 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.redeven-terminal-output-wave-bar\s*\{[\s\S]*?animation: none;/u);
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*?\.redeven-terminal-output-wave-bar\s*\{[\s\S]*?fill: currentColor;/u);
  });
});
