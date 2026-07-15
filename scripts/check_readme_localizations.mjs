#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, '..');
const MANIFEST_PATH = 'assets/readme/locales.json';
const SELECTOR_START = '<!-- readme-locales:start -->';
const SELECTOR_END = '<!-- readme-locales:end -->';

export class ReadmeValidationError extends Error {
  constructor(errors, warnings = []) {
    super(errors.join('\n'));
    this.name = 'ReadmeValidationError';
    this.errors = errors;
    this.warnings = warnings;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function stripLocaleSelector(content) {
  const start = content.indexOf(SELECTOR_START);
  const end = content.indexOf(SELECTOR_END);
  if (start === -1 || end === -1 || end < start) {
    return content;
  }
  return `${content.slice(0, start)}${content.slice(end + SELECTOR_END.length)}`;
}

export function normalizeReadmeContent(content) {
  return `${stripLocaleSelector(content).replace(/\r\n/g, '\n').trimEnd()}\n`;
}

export function contentSha256(content) {
  return createHash('sha256').update(normalizeReadmeContent(content)).digest('hex');
}

function extractSingleBlock(content, startMarker, endMarker, label, errors) {
  const firstStart = content.indexOf(startMarker);
  const firstEnd = content.indexOf(endMarker);
  if (firstStart === -1 || firstEnd === -1 || firstEnd < firstStart) {
    errors.push(`${label}: missing a complete ${startMarker} / ${endMarker} block`);
    return '';
  }
  if (content.indexOf(startMarker, firstStart + startMarker.length) !== -1) {
    errors.push(`${label}: locale selector start marker appears more than once`);
  }
  if (content.indexOf(endMarker, firstEnd + endMarker.length) !== -1) {
    errors.push(`${label}: locale selector end marker appears more than once`);
  }
  return content.slice(firstStart + startMarker.length, firstEnd);
}

export function validateLanguageSelector(content, manifest, currentLocale, label = currentLocale) {
  const errors = [];
  const selector = extractSingleBlock(content, SELECTOR_START, SELECTOR_END, label, errors);
  if (!selector) {
    return errors;
  }

  const entries = [];
  const entryPattern = /<a href="([^"]+)">([^<]+)<\/a>|<strong>([^<]+)<\/strong>/g;
  for (const match of selector.matchAll(entryPattern)) {
    if (match[1]) {
      entries.push({ type: 'link', file: match[1], name: match[2].trim() });
    } else {
      entries.push({ type: 'current', name: match[3].trim() });
    }
  }

  if (entries.length !== manifest.locales.length) {
    errors.push(`${label}: locale selector has ${entries.length} entries; expected ${manifest.locales.length}`);
    return errors;
  }

  manifest.locales.forEach((locale, index) => {
    const actual = entries[index];
    if (locale.locale === currentLocale) {
      if (actual.type !== 'current' || actual.name !== locale.native_name) {
        errors.push(`${label}: selector entry ${index + 1} must mark ${locale.native_name} as current`);
      }
      return;
    }
    if (actual.type !== 'link' || actual.name !== locale.native_name || actual.file !== locale.file) {
      errors.push(`${label}: selector entry ${index + 1} must link ${locale.native_name} to ${locale.file}`);
    }
  });

  return errors;
}

function extractMarkdownHeadings(content) {
  const headings = [];
  let fence = null;
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (fence === null) {
        fence = fenceMatch[1][0];
      } else if (fence === fenceMatch[1][0]) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      continue;
    }
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      headings.push({ level: headingMatch[1].length, text: headingMatch[2].trim() });
    }
  }
  return headings;
}

export function validateSections(content, manifest, label = 'README') {
  const errors = [];
  const markerIds = [...content.matchAll(/<!-- readme-section:([a-z0-9-]+) -->/g)].map((match) => match[1]);
  const expectedIds = manifest.sections.map((section) => section.id);
  if (JSON.stringify(markerIds) !== JSON.stringify(expectedIds)) {
    errors.push(`${label}: section marker order is ${JSON.stringify(markerIds)}; expected ${JSON.stringify(expectedIds)}`);
  }

  for (const section of manifest.sections) {
    const pattern = new RegExp(
      `<!-- readme-section:${escapeRegExp(section.id)} -->\\s*` +
        `<a id="${escapeRegExp(section.id)}"><\\/a>\\s*` +
        `#{${section.level}}\\s+[^\\n]+`,
    );
    if (!pattern.test(content)) {
      errors.push(`${label}: section ${section.id} must have its stable anchor and level-${section.level} heading`);
    }
  }

  const actualLevels = extractMarkdownHeadings(content).map((heading) => heading.level);
  const expectedLevels = [1, ...manifest.sections.map((section) => section.level)];
  if (JSON.stringify(actualLevels) !== JSON.stringify(expectedLevels)) {
    errors.push(`${label}: heading levels are ${JSON.stringify(actualLevels)}; expected ${JSON.stringify(expectedLevels)}`);
  }
  return errors;
}

function extractLinkDestinations(content) {
  const withoutSelector = stripLocaleSelector(content);
  const destinations = [];
  const markdownLink = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  const htmlLink = /\b(?:href|src)="([^"]+)"/g;
  for (const match of withoutSelector.matchAll(markdownLink)) {
    destinations.push(match[1]);
  }
  for (const match of withoutSelector.matchAll(htmlLink)) {
    destinations.push(match[1]);
  }
  return destinations.sort();
}

function validateLocalTargets(content, readmePath, repoRoot, label) {
  const errors = [];
  for (const destination of extractLinkDestinations(content)) {
    if (/^(?:https?:|mailto:|#)/.test(destination)) {
      continue;
    }
    const cleanPath = destination.split('#', 1)[0].split('?', 1)[0];
    if (!cleanPath) {
      continue;
    }
    const target = resolve(dirname(readmePath), cleanPath);
    if (!existsSync(target)) {
      errors.push(`${label}: local link target does not exist: ${destination}`);
    }
    const relativeTarget = relative(repoRoot, target);
    if (relativeTarget.startsWith('..')) {
      errors.push(`${label}: local link escapes the repository: ${destination}`);
    }
  }
  return errors;
}

function extractFencedCodeBlocks(content) {
  const blocks = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let current = null;
  for (const line of lines) {
    const open = line.match(/^\s*```([^`]*)$/);
    if (!current && open) {
      current = { info: open[1].trim(), lines: [] };
      continue;
    }
    if (current && /^\s*```\s*$/.test(line)) {
      blocks.push(current);
      current = null;
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }
  return blocks;
}

function executableBlockShape(block) {
  const lines = block.info === 'bash'
    ? block.lines.filter((line) => line.trim() !== '' && !/^\s*#/.test(line))
    : block.lines;
  return { info: block.info, lines };
}

function validateCodeBlocks(content, sourceContent, label) {
  const errors = [];
  const expected = extractFencedCodeBlocks(sourceContent).map(executableBlockShape);
  const actual = extractFencedCodeBlocks(content).map(executableBlockShape);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label}: executable fenced-code content differs from README.md`);
  }
  return errors;
}

function validateRequiredLiterals(content, manifest, label) {
  const errors = [];
  for (const literal of manifest.required_literals ?? []) {
    if (!content.includes(literal)) {
      errors.push(`${label}: required literal is missing: ${literal}`);
    }
  }
  return errors;
}

function validateTraditionalChinese(content, manifest, locale, label) {
  if (locale !== 'zh-TW') {
    return [];
  }
  const errors = [];
  const searchable = normalizeReadmeContent(content);
  const forbidden = manifest.quality_rules?.zh_tw_forbidden_simplified_characters ?? '';
  const found = [...new Set([...forbidden].filter((character) => searchable.includes(character)))];
  if (found.length > 0) {
    errors.push(`${label}: contains forbidden Simplified Chinese characters: ${found.join(' ')}`);
  }
  return errors;
}

function validateGenericEnglishTerms(content, manifest, locale, label) {
  if (locale === manifest.source.locale) {
    return [];
  }
  const errors = [];
  const searchable = normalizeReadmeContent(content);
  for (const term of manifest.quality_rules?.forbidden_generic_english_terms ?? []) {
    const pattern = new RegExp(`(^|[^A-Za-z])${escapeRegExp(term)}([^A-Za-z]|$)`);
    if (pattern.test(searchable)) {
      errors.push(`${label}: generic English term must be localized: ${term}`);
    }
  }
  return errors;
}

function readableProse(content) {
  return stripLocaleSelector(content)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/<[^>]+>/g, ' ');
}

function countFixedEnglishTermForm(content, form) {
  const pattern = new RegExp(`(?<![A-Za-z_])${escapeRegExp(form)}(?![A-Za-z_])`, 'g');
  return [...readableProse(content).matchAll(pattern)].length;
}

function validateFixedEnglishTerms(content, sourceContent, manifest, locale, label) {
  if (locale === manifest.source.locale) {
    return [];
  }
  const errors = [];
  for (const family of manifest.quality_rules?.fixed_english_term_families ?? []) {
    for (const form of family.forms ?? []) {
      const expected = countFixedEnglishTermForm(sourceContent, form);
      const actual = countFixedEnglishTermForm(content, form);
      if (actual !== expected) {
        errors.push(
          `${label}: fixed English term ${JSON.stringify(form)} count is ${actual}; expected ${expected} from README.md`,
        );
      }
    }
  }
  return errors;
}

function validateReview(locale, sourceHash, contentHash, requireReviewed, label) {
  if (!locale.review) {
    return { errors: [`${label}: missing translation review metadata`], warnings: [] };
  }
  const errors = [];
  const warnings = [];
  const review = locale.review;
  if (review.source_sha256 !== sourceHash) {
    errors.push(`${label}: source_sha256 is stale; expected ${sourceHash}`);
  }
  if (review.content_sha256 !== contentHash) {
    errors.push(`${label}: content_sha256 is stale; expected ${contentHash}`);
  }

  if (review.status === 'reviewed') {
    if (review.method !== 'subagent') {
      errors.push(`${label}: reviewed translation must use the subagent review method`);
    }
    if (typeof review.reviewed_by !== 'string' || !/^subagent:[a-z0-9_/-]+$/.test(review.reviewed_by)) {
      errors.push(`${label}: reviewed translation must identify its locale-review subagent`);
    }
    if (typeof review.reviewed_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(review.reviewed_at)) {
      errors.push(`${label}: reviewed translation must have a YYYY-MM-DD reviewed_at date`);
    }
  } else if (review.status === 'pending_subagent_review') {
    if (review.method !== null || review.reviewed_by !== null || review.reviewed_at !== null) {
      errors.push(`${label}: pending review must keep method, reviewed_by, and reviewed_at null`);
    }
    const message = `${label}: independent locale-review subagent approval is still pending`;
    if (requireReviewed) {
      errors.push(message);
    } else {
      warnings.push(message);
    }
  } else {
    errors.push(`${label}: unsupported review status ${JSON.stringify(review.status)}`);
  }
  return { errors, warnings };
}

function listTrackedMarkdown(repoRoot) {
  let output;
  try {
    output = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  } catch (error) {
    throw new Error(`failed to list tracked files: ${error.message}`);
  }
  return output.split('\0').filter((path) => path.endsWith('.md'));
}

function validateMarkdownAllowlist(repoRoot, manifest) {
  const allowedRootFiles = new Set([
    'AGENTS.md',
    'THIRD_PARTY_NOTICES.md',
    ...manifest.locales.map((locale) => locale.file),
    ...(manifest.tracked_markdown_exceptions ?? []).map((entry) => entry.path),
  ]);
  const errors = [];
  for (const path of listTrackedMarkdown(repoRoot)) {
    if (path.startsWith('okf/') || allowedRootFiles.has(path)) {
      continue;
    }
    errors.push(`tracked Markdown is outside the maintained allowlist: ${path}`);
  }
  return errors;
}

function validateManifestShape(manifest) {
  const errors = [];
  if (manifest.schema_version !== 1) {
    errors.push('manifest: schema_version must be 1');
  }
  if (!manifest.source || manifest.source.locale !== 'en-US' || manifest.source.file !== 'README.md') {
    errors.push('manifest: source must be en-US in README.md');
  }
  if (!Array.isArray(manifest.locales) || manifest.locales.length === 0) {
    errors.push('manifest: locales must be a non-empty array');
    return errors;
  }
  const localeIds = manifest.locales.map((locale) => locale.locale);
  const files = manifest.locales.map((locale) => locale.file);
  if (new Set(localeIds).size !== localeIds.length) {
    errors.push('manifest: locale identifiers must be unique');
  }
  if (new Set(files).size !== files.length) {
    errors.push('manifest: README file names must be unique');
  }
  if (localeIds[0] !== manifest.source.locale || files[0] !== manifest.source.file) {
    errors.push('manifest: the source locale must be the first locale entry');
  }
  return errors;
}

function validateRootReadmeFiles(repoRoot, manifest) {
  const expected = manifest.locales.map((locale) => locale.file).sort();
  const actual = readdirSync(repoRoot)
    .filter((name) => /^README(?:\.[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)?\.md$/.test(name))
    .sort();
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? []
    : [`root README files are ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`];
}

export function buildHashReport(repoRoot = DEFAULT_REPO_ROOT) {
  const manifest = readJson(resolve(repoRoot, MANIFEST_PATH));
  const sourceContent = readFileSync(resolve(repoRoot, manifest.source.file), 'utf8');
  const sourceHash = contentSha256(sourceContent);
  return {
    source_sha256: sourceHash,
    translations: Object.fromEntries(
      manifest.locales
        .filter((locale) => locale.locale !== manifest.source.locale)
        .map((locale) => [
          locale.locale,
          {
            source_sha256: sourceHash,
            content_sha256: contentSha256(readFileSync(resolve(repoRoot, locale.file), 'utf8')),
          },
        ]),
    ),
  };
}

export function validateRepository(repoRoot = DEFAULT_REPO_ROOT, options = {}) {
  const requireReviewed = options.requireReviewed ?? false;
  const manifest = readJson(resolve(repoRoot, MANIFEST_PATH));
  const errors = validateManifestShape(manifest);
  const warnings = [];
  if (errors.length > 0) {
    throw new ReadmeValidationError(errors, warnings);
  }

  errors.push(...validateRootReadmeFiles(repoRoot, manifest));
  errors.push(...validateMarkdownAllowlist(repoRoot, manifest));

  const sourcePath = resolve(repoRoot, manifest.source.file);
  const sourceContent = readFileSync(sourcePath, 'utf8');
  const sourceHash = contentSha256(sourceContent);
  const sourceLinks = extractLinkDestinations(sourceContent);

  for (const locale of manifest.locales) {
    const path = resolve(repoRoot, locale.file);
    const label = `${locale.locale} (${locale.file})`;
    if (!existsSync(path)) {
      errors.push(`${label}: file does not exist`);
      continue;
    }
    const content = readFileSync(path, 'utf8');
    errors.push(...validateLanguageSelector(content, manifest, locale.locale, label));
    errors.push(...validateSections(content, manifest, label));
    errors.push(...validateLocalTargets(content, path, repoRoot, label));
    errors.push(...validateRequiredLiterals(content, manifest, label));
    errors.push(...validateTraditionalChinese(content, manifest, locale.locale, label));
    errors.push(...validateGenericEnglishTerms(content, manifest, locale.locale, label));
    errors.push(...validateFixedEnglishTerms(content, sourceContent, manifest, locale.locale, label));

    if (locale.locale !== manifest.source.locale) {
      const links = extractLinkDestinations(content);
      if (JSON.stringify(links) !== JSON.stringify(sourceLinks)) {
        errors.push(`${label}: link and image destinations differ from README.md`);
      }
      errors.push(...validateCodeBlocks(content, sourceContent, label));
      const reviewResult = validateReview(locale, sourceHash, contentSha256(content), requireReviewed, label);
      errors.push(...reviewResult.errors);
      warnings.push(...reviewResult.warnings);
    }
  }

  if (errors.length > 0) {
    throw new ReadmeValidationError(errors, warnings);
  }
  return { manifest, warnings };
}

function parseArgs(argv) {
  const options = {
    repoRoot: DEFAULT_REPO_ROOT,
    requireReviewed: false,
    printHashes: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--require-reviewed') {
      options.requireReviewed = true;
    } else if (arg === '--print-hashes') {
      options.printHashes = true;
    } else if (arg === '--root') {
      index += 1;
      if (!argv[index]) {
        throw new Error('--root requires a path');
      }
      options.repoRoot = resolve(argv[index]);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.printHashes) {
      process.stdout.write(`${JSON.stringify(buildHashReport(options.repoRoot), null, 2)}\n`);
      return;
    }
    const result = validateRepository(options.repoRoot, { requireReviewed: options.requireReviewed });
    for (const warning of result.warnings) {
      process.stderr.write(`[WARN] ${warning}\n`);
    }
    process.stdout.write('[INFO] README localization check passed\n');
  } catch (error) {
    if (error instanceof ReadmeValidationError) {
      for (const warning of error.warnings) {
        process.stderr.write(`[WARN] ${warning}\n`);
      }
      for (const message of error.errors) {
        process.stderr.write(`[ERROR] ${message}\n`);
      }
    } else {
      process.stderr.write(`[ERROR] ${error.stack ?? error.message}\n`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
