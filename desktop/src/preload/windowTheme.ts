/// <reference lib="dom" />

import { ipcRenderer } from 'electron';

import {
  REPORT_DESKTOP_WINDOW_THEME_CHANNEL,
  type DesktopWindowThemeSnapshot,
} from '../shared/windowThemeIPC';
import { desktopWindowTitleBarInsetCSSValue, usesDesktopWindowThemeOverlay } from '../shared/windowChromePlatform';

const WINDOW_CHROME_STYLE_ID = 'redeven-desktop-window-chrome';
const WINDOW_CHROME_STYLE_TEXT = `
body > #root {
  box-sizing: border-box;
  padding-top: ${desktopWindowTitleBarInsetCSSValue(process.platform)};
}
`;

function compact(value: string): string {
  return String(value ?? '').trim();
}

function isTransparentColor(value: string): boolean {
  if (value === 'transparent') {
    return true;
  }
  const rgbaMatch = value.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)$/);
  if (!rgbaMatch) {
    return false;
  }
  return Number(rgbaMatch[1]) <= 0;
}

function normalizeWindowColor(value: string): string {
  const candidate = compact(value);
  if (!candidate) {
    return '';
  }

  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.pointerEvents = 'none';
  probe.style.opacity = '0';
  probe.style.color = candidate;
  document.body.appendChild(probe);
  const resolved = compact(window.getComputedStyle(probe).color);
  probe.remove();
  if (!resolved || isTransparentColor(resolved)) {
    return '';
  }
  if (resolved.startsWith('rgba(')) {
    return resolved;
  }
  const rgbMatch = resolved.match(/^rgb\((.+)\)$/);
  if (rgbMatch) {
    return `rgba(${rgbMatch[1]}, 1)`;
  }
  return resolved;
}

function readThemeSnapshot(): DesktopWindowThemeSnapshot {
  const root = document.documentElement;
  const rootStyle = window.getComputedStyle(root);
  const bodyStyle = document.body ? window.getComputedStyle(document.body) : null;

  const backgroundColor = normalizeWindowColor(bodyStyle?.backgroundColor ?? '')
    || normalizeWindowColor(rootStyle.backgroundColor)
    || normalizeWindowColor(rootStyle.getPropertyValue('--background'))
    || normalizeWindowColor(rootStyle.getPropertyValue('--bg'))
    || '#f3e5de';

  const symbolColor = normalizeWindowColor(bodyStyle?.color ?? '')
    || normalizeWindowColor(rootStyle.color)
    || normalizeWindowColor(rootStyle.getPropertyValue('--foreground'))
    || normalizeWindowColor(rootStyle.getPropertyValue('--text'))
    || '#181311';

  return {
    backgroundColor,
    symbolColor,
  };
}

function ensureWindowChromeStyle(): void {
  if (document.getElementById(WINDOW_CHROME_STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = WINDOW_CHROME_STYLE_ID;
  style.textContent = WINDOW_CHROME_STYLE_TEXT;
  document.head.appendChild(style);
}

export function bootstrapDesktopWindowThemeReporter(): void {
  if (!usesDesktopWindowThemeOverlay(process.platform)) {
    return;
  }

  let lastSnapshot = '';

  const reportTheme = () => {
    const snapshot = readThemeSnapshot();
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSnapshot) {
      return;
    }
    lastSnapshot = serialized;
    ipcRenderer.send(REPORT_DESKTOP_WINDOW_THEME_CHANNEL, snapshot);
  };

  const start = () => {
    ensureWindowChromeStyle();
    reportTheme();

    const observer = new MutationObserver(() => {
      reportTheme();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    if (document.body) {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    }
    window.addEventListener('load', reportTheme, { once: true });
    window.addEventListener('pageshow', reportTheme);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reportTheme);
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    return;
  }
  start();
}
