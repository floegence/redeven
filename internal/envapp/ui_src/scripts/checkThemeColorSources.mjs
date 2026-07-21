#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, '..');
const defaultRepositoryRoot = path.resolve(packageRoot, '../../..');

const PRODUCT_SOURCE_ROOTS = [
  'desktop/src',
  'internal/envapp/ui_src/src',
  'internal/flower_ui/src',
];
const PRODUCT_SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx']);
const TEST_SOURCE_PATTERN = /(?:^|\/)(?:__tests__|test)(?:\/|$)|\.(?:browser\.)?(?:test|spec|e2e)\.(?:ts|tsx|css)$/u;
const RAW_COLOR_PATTERN = /#[\da-f]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^)]*\)/giu;
const NAMED_COLOR_PATTERN = /(?<![\w-])(?:white|black)(?![\w-])/giu;
const FIXED_TAILWIND_PATTERN = /\b(?:bg|text|border|ring|fill|stroke|shadow|from|via|to)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\[[^\]]+\]|\/\d+)?(?![\w/[\]])/gu;

const CLASSIC_THEME_SELECTORS = new Set([
  ":root[data-floe-shell-theme='classic-light'],:root:not([data-floe-shell-theme]):not(.dark),:root:not([data-floe-shell-theme]).light",
  ":root[data-floe-shell-theme='classic-dark'],:root:not([data-floe-shell-theme]).dark",
]);
const GLOBAL_NEUTRAL_LIGHTING_TOKENS = new Set([
  '--redeven-surface-highlight-source',
  '--redeven-surface-shadow-source',
]);
const CATEGORICAL_SUPPLEMENT_SELECTORS = new Set([':root', ':root.dark']);

const EXCEPTION_OWNERS = new Set([
  'theme-source',
  'brand',
  'media',
  'terminal',
  'syntax',
  'diagram',
  'persisted',
  'desktop-fallback',
]);

function exception(pathname, owner, purpose, accepts) {
  if (!EXCEPTION_OWNERS.has(owner)) {
    throw new Error(`Unknown theme color exception owner: ${owner}`);
  }
  return Object.freeze({ pathname, owner, purpose, accepts });
}

function compactCssSelector(value) {
  return value.replace(/\s+/gu, '');
}

function cssBlockSelector(source, offset) {
  const blockStart = source.lastIndexOf('{', offset);
  const previousBlockEnd = source.lastIndexOf('}', offset);
  if (blockStart < 0 || blockStart < previousBlockEnd) return '';
  return compactCssSelector(source.slice(previousBlockEnd + 1, blockStart).trim());
}

function isClassicThemeDeclaration({ source, offset, lineSource }) {
  return /^\s*--[\w-]+\s*:/u.test(lineSource)
    && CLASSIC_THEME_SELECTORS.has(cssBlockSelector(source, offset));
}

function isGlobalNeutralLightingDeclaration({ source, offset, lineSource }) {
  const declaration = /^\s*(--[\w-]+)\s*:/u.exec(lineSource);
  return declaration !== null
    && GLOBAL_NEUTRAL_LIGHTING_TOKENS.has(declaration[1])
    && cssBlockSelector(source, offset) === ':root';
}

function isCategoricalSupplementDeclaration({ source, offset, lineSource }) {
  const declaration = /^\s*(--redeven-categorical-graph-(?:6|7|8))\s*:/u.exec(lineSource);
  if (!declaration) return false;
  return CATEGORICAL_SUPPLEMENT_SELECTORS.has(cssBlockSelector(source, offset));
}

function isDesktopThemeSourceDeclaration({ source, offset }) {
  const blocks = [
    'const classicLightSemanticPalette',
    'const classicDarkSemanticPalette',
    'const classicLightWindow',
    'const classicDarkWindow',
    'export const desktopLightTheme',
    'export const desktopDarkTheme',
  ];
  return blocks.some((marker) => {
    const start = source.indexOf(marker);
    if (start < 0 || offset < start) return false;
    const end = source.indexOf('} as const', start);
    return end > start && offset < end;
  });
}

// Exceptions are deliberately scoped by path and source context. A whole file or
// directory must never be exempted merely because it currently contains one valid color source.
export const THEME_COLOR_EXCEPTIONS = Object.freeze([
  exception(
    'desktop/src/preload/windowTheme.ts',
    'desktop-fallback',
    'The context-isolated preload owns one validated Classic Light bootstrap snapshot before IPC responds.',
    ({ source, offset }) => {
      const start = source.indexOf('function fallbackDesktopThemeSnapshot');
      const end = source.indexOf('function readDesktopThemeSnapshot', start);
      return start >= 0 && end > start && offset > start && offset < end;
    },
  ),
  exception(
    'desktop/src/main/desktopTheme.ts',
    'theme-source',
    'The Desktop adapter retains only the original Classic compatibility palette and native chrome fallback blocks; all other presets come from published Floe metadata.',
    isDesktopThemeSourceDeclaration,
  ),
  exception(
    'desktop/src/welcome/index.css',
    'media',
    'The QR module requires an exact paper-white quiet zone for reliable scanning.',
    ({ value, source, offset, lineSource }) => value.toLowerCase() === '#fff'
      && lineSource.includes('background:')
      && cssBlockSelector(source, offset) === '.redeven-endpoint-qr-card',
  ),
  exception(
    'internal/envapp/ui_src/src/styles/redeven.css',
    'theme-source',
    'Only exact Classic or no-preset fallback selectors own concrete Classic source colors.',
    isClassicThemeDeclaration,
  ),
  exception(
    'internal/envapp/ui_src/src/styles/redeven.css',
    'theme-source',
    'Global neutral lighting is owned only by the explicit highlight and shadow source tokens.',
    isGlobalNeutralLightingDeclaration,
  ),
  exception(
    'internal/envapp/ui_src/src/styles/redeven.css',
    'theme-source',
    'Only root categorical graph roles 6-8 own the contrast-calibrated supplemental data-visualization colors.',
    isCategoricalSupplementDeclaration,
  ),
  exception(
    'internal/envapp/ui_src/src/styles/redeven.css',
    'media',
    'The terminal activity ring uses an opaque mask stencil, not a visible product color.',
    ({ value, lineSource }) => value.toLowerCase() === '#000' && lineSource.includes('linear-gradient(#000 0 0)'),
  ),
  exception(
    'internal/envapp/ui_src/src/styles/redeven.css',
    'theme-source',
    'The Classic light settings shadow is a multiline semantic token declaration.',
    (context) => ['rgb(15 23 42 / 4%)', 'rgb(15 23 42 / 18%)'].includes(context.value)
      && CLASSIC_THEME_SELECTORS.has(cssBlockSelector(context.source, context.offset)),
  ),
  exception(
    'internal/envapp/ui_src/src/ui/icons/CodespacesIcon.tsx',
    'brand',
    'Codespaces icon artwork retains its authored SVG palette.',
    ({ lineSource }) => /(?:stop-color|\bfill|\bstroke)=/u.test(lineSource),
  ),
  exception(
    'internal/envapp/ui_src/src/ui/icons/CodexIcon.tsx',
    'brand',
    'Codex icon artwork retains its authored SVG palette.',
    ({ lineSource }) => /(?:stop-color|\bfill|\bstroke)=/u.test(lineSource),
  ),
  exception(
    'internal/flower_ui/src/icons/FlowerIcon.tsx',
    'brand',
    'Flower icon artwork retains its authored petal and center palette.',
    ({ lineSource }) => /(?:stop-color|\bfill|\bstroke)=/u.test(lineSource),
  ),
  exception(
    'internal/flower_ui/src/settings/providerBrandIcons.ts',
    'brand',
    'Provider marks retain their official authored colors.',
    ({ value, lineSource }) => /(?:\bcolor:|\bfills:)/u.test(lineSource)
      || ['#504af4', '#3485ff', '#6336e7', '#6f69f7'].includes(value.toLowerCase()),
  ),
  exception(
    'internal/envapp/ui_src/src/ui/chat/blocks/ImageBlock.tsx',
    'media',
    'The image lightbox backdrop is a media inspection surface.',
    ({ value, lineSource }) => value === 'rgba(0, 0, 0, 0.8)' && lineSource.includes("'background-color'"),
  ),
  exception(
    'internal/envapp/ui_src/src/ui/chat/chat.css',
    'media',
    'Image lightbox controls use a stable dark inspection chrome over arbitrary media.',
    ({ lineSource }) => lineSource.includes('.chat-image-dialog-'),
  ),
  exception(
    'internal/envapp/ui_src/src/ui/file-preview/rendererRegistry.tsx',
    'media',
    'Video preview letterboxing stays black for faithful media presentation.',
    ({ value, lineSource }) => value === 'bg-black' && lineSource.includes('min-h-[18rem]'),
  ),
  exception(
    'internal/envapp/ui_src/src/ui/widgets/PdfPreviewPane.tsx',
    'media',
    'Rendered PDF pages retain a paper-white canvas independent of application chrome.',
    ({ value, lineSource }) => value === 'bg-white' && lineSource.includes('pdf-preview-pane__page-frame'),
  ),
  exception(
    'internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx',
    'terminal',
    'The xterm fallback palette is used only before the selected terminal theme resolves.',
    ({ value, lineSource }) => ['#1e1e1e', '#c9d1d9'].includes(value.toLowerCase())
      && lineSource.includes('terminalTheme'),
  ),
  exception(
    'internal/envapp/ui_src/src/ui/widgets/TerminalSessionRuntime.tsx',
    'terminal',
    'The detached xterm runtime fallback is used only before terminal theme colors resolve.',
    ({ value, lineSource }) => ['#1e1e1e', '#c9d1d9'].includes(value.toLowerCase())
      && /terminal(?:Background|Foreground)/u.test(lineSource),
  ),
  exception(
    'internal/envapp/ui_src/src/ui/file-markdown/mermaidPlugin.ts',
    'diagram',
    'Mermaid needs deterministic light and dark fallbacks before computed theme tokens are available.',
    ({ value, lineSource }) => ['#ffffff', '#171b22', '#1f2937', '#f3f4f6'].includes(value.toLowerCase())
      && /readSemanticColor\(style/u.test(lineSource),
  ),
  exception(
    'internal/envapp/ui_src/src/ui/widgets/GitCommitGraph.tsx',
    'diagram',
    'Git graph lanes use a stable categorical palette to preserve lane identity.',
    ({ lineSource }) => lineSource.includes("'rgb(") || lineSource.includes("'color-mix(in srgb, rgb("),
  ),
  exception(
    'internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx',
    'diagram',
    'Workbench placeholder illustration colors are part of the diagram artwork.',
    ({ lineSource }) => /(?:stop-color|\bfill|\bstroke)=/u.test(lineSource),
  ),
  exception(
    'internal/envapp/ui_src/src/ui/workbench/workbenchInitialCanvasPreset.ts',
    'persisted',
    'Initial annotation and background colors are serialized user-canvas data.',
    ({ lineSource }) => /^\s*(?:color|fill):/u.test(lineSource),
  ),
]);

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function lineDetails(source, offset) {
  const lineNumber = source.slice(0, offset).split('\n').length;
  const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const nextBreak = source.indexOf('\n', offset);
  const lineEnd = nextBreak === -1 ? source.length : nextBreak;
  return { lineNumber, lineSource: source.slice(lineStart, lineEnd) };
}

function isProductionSource(relativePath) {
  const normalized = normalizePath(relativePath);
  return PRODUCT_SOURCE_EXTENSIONS.has(path.extname(normalized))
    && !TEST_SOURCE_PATTERN.test(normalized);
}

function walkProductSources(repositoryRoot, relativeDirectory, files) {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) return;
  const entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = normalizePath(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      walkProductSources(repositoryRoot, relativePath, files);
    } else if (entry.isFile() && isProductionSource(relativePath)) {
      files.push(relativePath);
    }
  }
}

export function listThemeColorSourceFiles(
  repositoryRoot = defaultRepositoryRoot,
  sourceRoots = PRODUCT_SOURCE_ROOTS,
) {
  const files = [];
  for (const sourceRoot of sourceRoots) {
    walkProductSources(repositoryRoot, sourceRoot, files);
  }
  return files;
}

function isAllowedColor(context, exceptions) {
  return exceptions.some((entry) => (
    entry.pathname === context.filePath && entry.accepts(context)
  ));
}

function maskSourceComments(source) {
  const chars = [...source];
  let state = 'code';
  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index];
    const next = chars[index + 1];

    if (state === 'line-comment') {
      if (current === '\n') state = 'code';
      else chars[index] = ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (current === '*' && next === '/') {
        chars[index] = ' ';
        chars[index + 1] = ' ';
        index += 1;
        state = 'code';
      } else if (current !== '\n') {
        chars[index] = ' ';
      }
      continue;
    }
    if (state === 'single-quote' || state === 'double-quote' || state === 'template') {
      if (current === '\\') {
        index += 1;
        continue;
      }
      if (
        (state === 'single-quote' && current === "'")
        || (state === 'double-quote' && current === '"')
        || (state === 'template' && current === '`')
      ) {
        state = 'code';
      }
      continue;
    }
    if (current === '/' && next === '/') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index += 1;
      state = 'line-comment';
    } else if (current === '/' && next === '*') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index += 1;
      state = 'block-comment';
    } else if (current === "'") {
      state = 'single-quote';
    } else if (current === '"') {
      state = 'double-quote';
    } else if (current === '`') {
      state = 'template';
    }
  }
  return chars.join('');
}

function fixedColorMatches(source) {
  const matches = [];
  const scannableSource = maskSourceComments(source);
  for (const pattern of [RAW_COLOR_PATTERN, NAMED_COLOR_PATTERN, FIXED_TAILWIND_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of scannableSource.matchAll(pattern)) {
      const offset = match.index ?? 0;
      const value = source.slice(offset, offset + match[0].length);
      if (value.includes('${string}')) {
        continue;
      }
      if (/^(?:hsla?|rgba?|oklch|oklab|lab|lch)\(/iu.test(value) && value.includes('var(')) {
        continue;
      }
      matches.push({ offset, value });
    }
  }
  return matches.sort((left, right) => left.offset - right.offset);
}

export function findThemeColorViolations(
  source,
  filePath = 'source',
  exceptions = THEME_COLOR_EXCEPTIONS,
) {
  const violations = [];
  for (const match of fixedColorMatches(source)) {
    const details = lineDetails(source, match.offset);
    const context = {
      filePath: normalizePath(filePath),
      value: match.value,
      source,
      offset: match.offset,
      lineNumber: details.lineNumber,
      lineSource: details.lineSource,
    };
    if (isAllowedColor(context, exceptions)) continue;
    violations.push(
      `${context.filePath}:${context.lineNumber}: replace ${context.value} with a semantic theme token or add a precise owner/path/use exception`,
    );
  }
  return violations;
}

export function checkThemeColorSources({
  repositoryRoot = defaultRepositoryRoot,
  sourceRoots = PRODUCT_SOURCE_ROOTS,
  exceptions = THEME_COLOR_EXCEPTIONS,
} = {}) {
  const violations = [];
  for (const relativePath of listThemeColorSourceFiles(repositoryRoot, sourceRoots)) {
    const source = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
    violations.push(...findThemeColorViolations(source, relativePath, exceptions));
  }
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = checkThemeColorSources();
  if (violations.length > 0) {
    process.stderr.write(`${violations.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Theme color source contract passed.\n');
  }
}
