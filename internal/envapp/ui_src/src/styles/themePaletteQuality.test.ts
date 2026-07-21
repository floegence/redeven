import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';

type Rgb = readonly [number, number, number];
type ThemeProfile = Readonly<{
  name: string;
  mode: 'light' | 'dark';
  background: string;
  card: string;
  foreground: string;
  charts: readonly [string, string, string, string, string];
}>;

const here = fileURLToPath(import.meta.url);
const stylesDir = path.dirname(here);

function readRedevenCss(): string {
  return fs.readFileSync(path.join(stylesDir, 'redeven.css'), 'utf8');
}

function publishedThemeProfiles(): readonly ThemeProfile[] {
  return builtInShellThemePresets.map((preset) => {
    const mode = preset.mode;
    if (mode !== 'light' && mode !== 'dark') {
      throw new Error(`Unsupported Floe preset mode for ${preset.name}`);
    }
    const tokens = preset.semanticTokens ?? {};
    const token = (name: string): string => {
      const value = tokens[`--${name}`];
      if (!value) throw new Error(`Missing ${preset.name} token --${name}`);
      return value;
    };
    return {
      name: preset.name,
      mode,
      background: token('background'),
      card: token('card'),
      foreground: token('foreground'),
      charts: [1, 2, 3, 4, 5].map((index) => token(`chart-${index}`)) as unknown as ThemeProfile['charts'],
    };
  });
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = ((hue % 360) + 360) % 360 / 60;
  const intermediate = chroma * (1 - Math.abs(section % 2 - 1));
  const [red, green, blue] = section < 1 ? [chroma, intermediate, 0]
    : section < 2 ? [intermediate, chroma, 0]
      : section < 3 ? [0, chroma, intermediate]
        : section < 4 ? [0, intermediate, chroma]
          : section < 5 ? [intermediate, 0, chroma]
            : [chroma, 0, intermediate];
  const offset = lightness - chroma / 2;
  return [red + offset, green + offset, blue + offset];
}

function oklchToRgb(lightness: number, chroma: number, hue: number): Rgb {
  const radians = hue * Math.PI / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const encode = (channel: number) => {
    const encoded = channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * channel ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, encoded));
  };
  return [
    encode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    encode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    encode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function parseColor(value: string): Rgb {
  const normalized = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/u.exec(normalized);
  if (hex) {
    const expanded = hex[1].length === 3
      ? [...hex[1]].map((channel) => channel.repeat(2)).join('')
      : hex[1];
    return [0, 2, 4].map((offset) => (
      Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255
    )) as unknown as Rgb;
  }
  const rgb = /^rgb\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*\)$/u.exec(normalized);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  const hsl = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/u.exec(normalized);
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
  const oklch = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/u.exec(normalized);
  if (oklch) return oklchToRgb(Number(oklch[1]), Number(oklch[2]), Number(oklch[3]));
  throw new Error(`Unsupported theme color: ${value}`);
}

function mix(first: Rgb, second: Rgb, firstWeight: number): Rgb {
  return first.map((channel, index) => (
    channel * firstWeight + second[index] * (1 - firstWeight)
  )) as unknown as Rgb;
}

function relativeLuminance(color: Rgb): number {
  const linear = color.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: Rgb, second: Rgb): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function oklab(color: Rgb): Rgb {
  const [red, green, blue] = color.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaEOK(first: Rgb, second: Rgb): number {
  const firstLab = oklab(first);
  const secondLab = oklab(second);
  return Math.hypot(...firstLab.map((channel, index) => channel - secondLab[index]));
}

function graphPalette(profile: ThemeProfile): readonly Rgb[] {
  const officialOrder = [1, 3, 0, 2, 4].map((index) => parseColor(profile.charts[index]));
  if (profile.name === 'classic-light') {
    const foreground = parseColor(profile.foreground);
    officialOrder[1] = mix(officialOrder[1], foreground, 0.65);
    officialOrder[4] = mix(officialOrder[4], foreground, 0.65);
  }
  const supplemental = profile.mode === 'dark'
    ? [oklchToRgb(0.78, 0.15, 30), oklchToRgb(0.78, 0.13, 195), oklchToRgb(0.78, 0.15, 320)]
    : [oklchToRgb(0.48, 0.17, 30), oklchToRgb(0.46, 0.13, 195), oklchToRgb(0.48, 0.16, 320)];
  return [...officialOrder, ...supplemental];
}

function runtimeMonitorPalette(profile: ThemeProfile): readonly [Rgb, Rgb, Rgb] {
  const graph = graphPalette(profile);
  if (profile.name === 'nord') {
    return [
      graph[0],
      mix(graph[1], parseColor(profile.foreground), 0.75),
      graph[2],
    ];
  }
  return [graph[0], graph[1], graph[4]];
}

describe('Redeven 22-preset color quality', () => {
  const profiles = publishedThemeProfiles();

  it('keeps all published light and dark presets in the executable matrix', () => {
    expect(profiles).toHaveLength(22);
    expect(profiles.filter((profile) => profile.mode === 'light')).toHaveLength(11);
    expect(profiles.filter((profile) => profile.mode === 'dark')).toHaveLength(11);
  });

  it('keeps graph roles visible, adjacent roles distinct, and text roles readable', () => {
    for (const profile of profiles) {
      const backgrounds = [parseColor(profile.background), parseColor(profile.card)];
      const foreground = parseColor(profile.foreground);
      const graph = graphPalette(profile);
      const text = graph.map((color) => mix(color, foreground, 0.7));

      for (const [index, color] of graph.entries()) {
        for (const background of backgrounds) {
          expect(contrastRatio(color, background), `${profile.name} graph ${index + 1}`).toBeGreaterThanOrEqual(3);
          expect(contrastRatio(text[index], background), `${profile.name} text ${index + 1}`).toBeGreaterThanOrEqual(4.5);
        }
        if (index > 0) {
          expect(deltaEOK(graph[index - 1], color), `${profile.name} graph ${index}/${index + 1}`).toBeGreaterThanOrEqual(0.08);
        }
      }
    }
  });

  it('keeps the three runtime monitor lines bright and mutually distinct in every dark preset', () => {
    for (const profile of profiles.filter((entry) => entry.mode === 'dark')) {
      const monitor = runtimeMonitorPalette(profile);
      const backgrounds = [parseColor(profile.background), parseColor(profile.card)];
      for (const [index, color] of monitor.entries()) {
        for (const background of backgrounds) {
          expect(contrastRatio(color, background), `${profile.name} monitor ${index + 1}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (let first = 0; first < monitor.length; first += 1) {
        for (let second = first + 1; second < monitor.length; second += 1) {
          expect(deltaEOK(monitor[first], monitor[second]), `${profile.name} monitor ${first + 1}/${second + 1}`)
            .toBeGreaterThanOrEqual(0.08);
        }
      }
    }
  });

  it('binds the verified model to the shipped semantic CSS contract', () => {
    const css = readRedevenCss();
    expect(css).toContain('--redeven-categorical-graph-1: var(--chart-2,');
    expect(css).toContain('--redeven-categorical-graph-2: var(--chart-4,');
    expect(css).toContain('--redeven-categorical-graph-3: var(--chart-1,');
    expect(css).toContain('--redeven-categorical-graph-4: var(--chart-3,');
    expect(css).toContain('--redeven-categorical-graph-5: var(--chart-5,');
    expect(css).toContain('--redeven-categorical-1: color-mix(in srgb, var(--redeven-categorical-graph-1) 70%, var(--foreground) 30%);');
    expect(css).toContain('--redeven-runtime-monitor-cpu-line: var(--redeven-categorical-graph-1);');
    expect(css).toContain('--redeven-runtime-monitor-download-line: var(--redeven-categorical-graph-2);');
    expect(css).toContain('--redeven-runtime-monitor-upload-line: var(--redeven-categorical-graph-5);');
    expect(css).toContain(":root.dark[data-floe-shell-theme='nord']");
    expect(css).toContain('--redeven-runtime-monitor-download-line: color-mix(in srgb, var(--redeven-categorical-graph-2) 75%, var(--foreground) 25%);');
    expect(css).toContain('--redeven-runtime-monitor-upload-line: var(--redeven-categorical-graph-3);');
  });
});
