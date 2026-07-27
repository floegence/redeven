import type { PluginSurfaceContext } from '@floegence/redevplugin-ui';

const surfaceColorTokens = {
  canvas: '--background',
  surface: '--card',
  surface_elevated: '--popover',
  text: '--foreground',
  text_muted: '--muted-foreground',
  border: '--border',
  accent: '--primary',
  accent_text: '--primary-foreground',
  success: '--success',
  warning: '--warning',
  danger: '--error',
  focus: '--ring',
} as const;

const lightSurfaceColorFallbacks: PluginSurfaceContext['appearance']['colors'] = {
  canvas: '#f4f1ed', surface: '#fffdfa', surface_elevated: '#ffffff', text: '#202a37',
  text_muted: '#5a687c', border: '#d8d3cc', accent: '#202a37', accent_text: '#fffdfa',
  success: '#237a57', warning: '#9a6700', danger: '#c23b3b', focus: '#3976c5',
};

const darkSurfaceColorFallbacks: PluginSurfaceContext['appearance']['colors'] = {
  canvas: '#171b22', surface: '#20262f', surface_elevated: '#29313c', text: '#f3f4f6',
  text_muted: '#a8b0bd', border: '#59616e', accent: '#f3f4f6', accent_text: '#171b22',
  success: '#5db98b', warning: '#d8aa55', danger: '#e77676', focus: '#82aef0',
};

function normalizeSurfaceColor(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  const hex = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/u.exec(normalized);
  if (hex) {
    const raw = hex[1];
    return raw.length === 3
      ? `#${[...raw].map((channel) => channel.repeat(2)).join('')}`
      : `#${raw}`;
  }

  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/u.exec(normalized);
  if (!rgb) return undefined;
  const channel = (raw: string) => Math.max(0, Math.min(255, Math.round(Number(raw))))
    .toString(16)
    .padStart(2, '0');
  const alphaValue = rgb[4]?.endsWith('%')
    ? Number(rgb[4].slice(0, -1)) * 2.55
    : Number(rgb[4] ?? '1') * 255;
  const alpha = Math.max(0, Math.min(255, Math.round(alphaValue)));
  return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}${alpha < 255 ? alpha.toString(16).padStart(2, '0') : ''}`;
}

function resolveSurfaceColor(rootStyle: CSSStyleDeclaration, token: string, fallback: string): string {
  const direct = normalizeSurfaceColor(rootStyle.getPropertyValue(token));
  if (direct) return direct;

  const probe = document.createElement('span');
  probe.hidden = true;
  probe.style.color = `var(${token}, ${fallback})`;
  document.body.append(probe);
  const resolved = normalizeSurfaceColor(getComputedStyle(probe).color);
  probe.remove();
  return resolved ?? fallback;
}

export function createRedevenPluginSurfaceContext(
  revision: number,
  languageTag: string,
): PluginSurfaceContext {
  const root = document.documentElement;
  const rootStyle = getComputedStyle(root);
  const colorScheme = root.classList.contains('dark')
    || (!root.classList.contains('light') && /\bdark\b/u.test(rootStyle.colorScheme))
    ? 'dark'
    : 'light';
  const fallbacks = colorScheme === 'dark' ? darkSurfaceColorFallbacks : lightSurfaceColorFallbacks;
  const colors = Object.fromEntries(Object.entries(surfaceColorTokens).map(([name, token]) => [
    name,
    resolveSurfaceColor(rootStyle, token, fallbacks[name as keyof typeof fallbacks]),
  ])) as PluginSurfaceContext['appearance']['colors'];

  return {
    schema_version: 'redevplugin.surface_context.v1',
    revision,
    appearance: { color_scheme: colorScheme, colors },
    locale: {
      language_tag: languageTag,
      direction: root.dir === 'rtl' ? 'rtl' : 'ltr',
    },
  };
}

export function pluginSurfaceContextFingerprint(context: PluginSurfaceContext): string {
  return JSON.stringify({ appearance: context.appearance, locale: context.locale });
}
