import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { normalizeDesktopSSHPort } from '../shared/desktopSSH';
import type { DesktopSSHConfigHost } from '../shared/desktopSSHConfig';

const DEFAULT_MAX_SSH_CONFIG_FILES = 32;
const DEFAULT_MAX_SSH_CONFIG_FILE_BYTES = 512 * 1024;
const DEFAULT_MAX_INCLUDE_DEPTH = 4;
const DEFAULT_MAX_GLOB_ENTRIES = 128;
const DEFAULT_MAX_GLOB_WALK_DEPTH = 6;

export type LoadDesktopSSHConfigHostsOptions = Readonly<{
  homeDir?: string;
  configPath?: string;
  maxFiles?: number;
  maxFileBytes?: number;
  maxIncludeDepth?: number;
  maxGlobEntries?: number;
}>;

type SSHConfigReadContext = Readonly<{
  homeDir: string;
  maxFiles: number;
  maxFileBytes: number;
  maxIncludeDepth: number;
  maxGlobEntries: number;
  visitedFiles: Set<string>;
  seenAliases: Set<string>;
}>;

type SSHConfigHostBlock = {
  aliases: string[];
  host_name: string;
  user: string;
  port: number | null;
  source_path: string;
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function stripInlineCommentAndTokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | '\'' | '' = '';
  let hasToken = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (quote !== '') {
      if (char === quote) {
        quote = '';
      } else if (char === '\\' && quote === '"') {
        index += 1;
        current += line[index] ?? '';
        hasToken = true;
      } else {
        current += char;
        hasToken = true;
      }
      continue;
    }
    if (char === '#') {
      break;
    }
    if (/\s/u.test(char)) {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      hasToken = true;
      continue;
    }
    if (char === '\\') {
      index += 1;
      current += line[index] ?? '';
      hasToken = true;
      continue;
    }
    current += char;
    hasToken = true;
  }
  if (hasToken) {
    tokens.push(current);
  }
  return tokens;
}

function normalizeSSHConfigPort(value: string): number | null {
  try {
    return normalizeDesktopSSHPort(value);
  } catch {
    return null;
  }
}

function isConcreteHostAlias(alias: string): boolean {
  const clean = compact(alias);
  return clean !== ''
    && !clean.startsWith('!')
    && !clean.startsWith('-')
    && !clean.includes('*')
    && !clean.includes('?')
    && !clean.includes('://');
}

function hostFromBlock(block: SSHConfigHostBlock, alias: string): DesktopSSHConfigHost {
  return {
    alias,
    host_name: block.host_name,
    user: block.user,
    port: block.port,
    source_path: block.source_path,
  };
}

function commitHostBlock(
  block: SSHConfigHostBlock | null,
  hosts: DesktopSSHConfigHost[],
  seenAliases: Set<string>,
): void {
  if (!block) {
    return;
  }
  for (const alias of block.aliases) {
    if (!isConcreteHostAlias(alias) || seenAliases.has(alias)) {
      continue;
    }
    seenAliases.add(alias);
    hosts.push(hostFromBlock(block, alias));
  }
}

function expandHome(rawPath: string, homeDir: string): string {
  const clean = compact(rawPath);
  if (clean === '~') {
    return homeDir;
  }
  if (clean.startsWith('~/')) {
    return path.join(homeDir, clean.slice(2));
  }
  return clean;
}

function hasGlobPattern(value: string): boolean {
  return /[*?]/u.test(value);
}

function normalizeGlobPath(value: string): string {
  return value.split(path.sep).join('/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/gu, '\\$&');
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (const char of normalizeGlobPath(pattern)) {
    if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(char);
    }
  }
  source += '$';
  return new RegExp(source, 'u');
}

function staticRootForGlob(pattern: string): string {
  const parsed = path.parse(pattern);
  const parts = pattern.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let root = parsed.root || path.sep;
  for (const part of parts) {
    if (hasGlobPattern(part)) {
      break;
    }
    root = path.join(root, part);
  }
  return root;
}

async function collectGlobMatches(
  root: string,
  pattern: string,
  limit: number,
  depth = 0,
): Promise<string[]> {
  if (depth > DEFAULT_MAX_GLOB_WALK_DEPTH || limit <= 0) {
    return [];
  }
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const regex = globToRegExp(pattern);
  const matches: string[] = [];
  for (const entry of entries) {
    if (matches.length >= limit) {
      break;
    }
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && regex.test(normalizeGlobPath(candidate))) {
      matches.push(candidate);
      continue;
    }
    if (entry.isDirectory()) {
      const nested = await collectGlobMatches(candidate, pattern, limit - matches.length, depth + 1);
      matches.push(...nested);
    }
  }
  return matches;
}

async function expandIncludeToken(
  token: string,
  baseDir: string,
  context: SSHConfigReadContext,
): Promise<string[]> {
  const expanded = expandHome(token, context.homeDir);
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
  if (!hasGlobPattern(absolute)) {
    return [absolute];
  }
  const root = staticRootForGlob(absolute);
  const matches = await collectGlobMatches(root, absolute, context.maxGlobEntries);
  matches.sort((left, right) => left.localeCompare(right));
  return matches;
}

async function parseSSHConfigFile(
  filePath: string,
  context: SSHConfigReadContext,
  depth = 0,
): Promise<DesktopSSHConfigHost[]> {
  if (depth > context.maxIncludeDepth || context.visitedFiles.size >= context.maxFiles) {
    return [];
  }
  const resolvedPath = path.resolve(filePath);
  if (context.visitedFiles.has(resolvedPath)) {
    return [];
  }
  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch {
    return [];
  }
  if (!stat.isFile() || stat.size > context.maxFileBytes) {
    return [];
  }
  context.visitedFiles.add(resolvedPath);

  let raw = '';
  try {
    raw = await fs.readFile(resolvedPath, 'utf8');
  } catch {
    return [];
  }

  const hosts: DesktopSSHConfigHost[] = [];
  const baseDir = path.dirname(resolvedPath);
  let activeBlock: SSHConfigHostBlock | null = null;

  for (const line of raw.split(/\r?\n/u)) {
    const tokens = stripInlineCommentAndTokenize(line);
    if (tokens.length <= 0) {
      continue;
    }
    const directive = compact(tokens[0]).toLowerCase();
    const values = tokens.slice(1).map(compact).filter(Boolean);
    if (directive === 'include') {
      for (const includeToken of values) {
        for (const includePath of await expandIncludeToken(includeToken, baseDir, context)) {
          hosts.push(...await parseSSHConfigFile(includePath, context, depth + 1));
        }
      }
      continue;
    }
    if (directive === 'host') {
      commitHostBlock(activeBlock, hosts, context.seenAliases);
      activeBlock = {
        aliases: values,
        host_name: '',
        user: '',
        port: null,
        source_path: resolvedPath,
      };
      continue;
    }
    if (!activeBlock || values.length <= 0) {
      continue;
    }
    switch (directive) {
      case 'hostname':
        activeBlock.host_name = values[0] ?? '';
        break;
      case 'user':
        activeBlock.user = values[0] ?? '';
        break;
      case 'port':
        activeBlock.port = normalizeSSHConfigPort(values[0] ?? '');
        break;
      default:
        break;
    }
  }

  commitHostBlock(activeBlock, hosts, context.seenAliases);
  return hosts;
}

export async function loadDesktopSSHConfigHosts(
  options: LoadDesktopSSHConfigHostsOptions = {},
): Promise<readonly DesktopSSHConfigHost[]> {
  const homeDir = compact(options.homeDir) || os.homedir();
  const configPath = compact(options.configPath) || path.join(homeDir, '.ssh', 'config');
  const context: SSHConfigReadContext = {
    homeDir,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_SSH_CONFIG_FILES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_SSH_CONFIG_FILE_BYTES,
    maxIncludeDepth: options.maxIncludeDepth ?? DEFAULT_MAX_INCLUDE_DEPTH,
    maxGlobEntries: options.maxGlobEntries ?? DEFAULT_MAX_GLOB_ENTRIES,
    visitedFiles: new Set<string>(),
    seenAliases: new Set<string>(),
  };
  const hosts = await parseSSHConfigFile(configPath, context);
  hosts.sort((left, right) => left.alias.localeCompare(right.alias));
  return hosts;
}
