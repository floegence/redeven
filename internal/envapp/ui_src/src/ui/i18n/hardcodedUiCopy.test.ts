import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type Finding = Readonly<{
  file: string;
  kind: 'text' | 'expression' | 'title' | 'aria-label' | 'placeholder' | 'alt';
  text: string;
}>;

type Exception = Finding & Readonly<{ reason: string }>;

const VISIBLE_ATTRIBUTES = new Set([
  'title',
  'aria-label',
  'placeholder',
  'alt',
  'label',
  'message',
  'description',
  'detail',
  'tooltip',
  'eyebrow',
  'loadingLabel',
  'loadingStatus',
  'buttonLabel',
  'confirmLabel',
  'cancelLabel',
]);

const EXCEPTIONS: readonly Exception[] = [
  { file: 'src/ui/EnvAppShell.tsx', kind: 'alt', text: 'Redeven', reason: 'Protected product name used as the logo alternative text.' },
  { file: 'src/ui/chat/input/ChatInput.tsx', kind: 'text', text: 'Enter', reason: 'Keyboard key label.' },
  { file: 'src/ui/chat/input/ChatInput.tsx', kind: 'text', text: 'Shift+Enter', reason: 'Keyboard shortcut label.' },
  { file: 'src/ui/chat/message/MessageAvatar.tsx', kind: 'expression', text: 'AI', reason: 'Standard artificial-intelligence acronym used in an avatar.' },
  { file: 'src/ui/codex/CodexSidebarShell.tsx', kind: 'text', text: 'Codex', reason: 'Protected product name.' },
  { file: 'src/ui/debugConsole/DebugConsoleWindow.tsx', kind: 'text', text: 'collect_ui_metrics', reason: 'Raw event identifier shown by the diagnostic console.' },
  { file: 'src/ui/debugConsole/DebugConsoleWindow.tsx', kind: 'text', text: 'visible', reason: 'Raw lifecycle enum value in the diagnostic console.' },
  { file: 'src/ui/debugConsole/DebugConsoleWindow.tsx', kind: 'text', text: 'minimized', reason: 'Raw lifecycle enum value in the diagnostic console.' },
  { file: 'src/ui/pages/EnvPortForwardsPage.tsx', kind: 'text', text: 'ms', reason: 'Standard millisecond unit.' },
  { file: 'src/ui/pages/settings/AIProviderDialog.tsx', kind: 'placeholder', text: 'model-name', reason: 'Wire-format model identifier example.' },
  { file: 'src/ui/pages/settings/sections/CodespacesSection.tsx', kind: 'text', text: 'code_server_port_min', reason: 'Configuration field name.' },
  { file: 'src/ui/pages/settings/sections/CodespacesSection.tsx', kind: 'text', text: 'code_server_port_max', reason: 'Configuration field name.' },
  { file: 'src/ui/pages/settings/sections/PermissionPolicySection.tsx', kind: 'title', text: 'local_max', reason: 'Policy field name.' },
  { file: 'src/ui/pages/settings/sections/PermissionPolicySection.tsx', kind: 'title', text: 'by_user', reason: 'Policy field name.' },
  { file: 'src/ui/pages/settings/sections/PermissionPolicySection.tsx', kind: 'placeholder', text: 'user_public_id', reason: 'Identifier field example.' },
  { file: 'src/ui/pages/settings/sections/PermissionPolicySection.tsx', kind: 'title', text: 'by_app', reason: 'Policy field name.' },
  { file: 'src/ui/pages/settings/sections/PermissionPolicySection.tsx', kind: 'placeholder', text: 'floe_app identifier', reason: 'Identifier field example.' },
  { file: 'src/ui/pages/settings/sections/RuntimeConfigSection.tsx', kind: 'title', text: 'agent_home_dir', reason: 'Runtime configuration field name.' },
  { file: 'src/ui/pages/settings/sections/RuntimeConfigSection.tsx', kind: 'placeholder', text: '/home/user', reason: 'Filesystem path example.' },
  { file: 'src/ui/pages/settings/sections/RuntimeConfigSection.tsx', kind: 'title', text: 'shell', reason: 'Runtime configuration field name.' },
  { file: 'src/ui/pages/settings/sections/RuntimeConfigSection.tsx', kind: 'placeholder', text: '/bin/bash', reason: 'Executable path example.' },
  { file: 'src/ui/pages/settings/sections/RuntimeConfigSection.tsx', kind: 'placeholder', text: '/path/to/folder', reason: 'Filesystem path example.' },
  { file: 'src/ui/pages/settings/sections/SkillsSection.tsx', kind: 'placeholder', text: 'https://github.com/openai/skills/tree/main/skills/.curated/skill-installer', reason: 'Repository URL example.' },
  { file: 'src/ui/pages/settings/sections/SkillsSection.tsx', kind: 'placeholder', text: 'openai/skills', reason: 'Repository identifier example.' },
  { file: 'src/ui/pages/settings/sections/SkillsSection.tsx', kind: 'placeholder', text: 'main', reason: 'Git branch name example.' },
  { file: 'src/ui/pages/settings/sections/SkillsSection.tsx', kind: 'placeholder', text: 'incident-response', reason: 'Skill identifier example.' },
  { file: 'src/ui/widgets/PdfPreviewPane.tsx', kind: 'text', text: 'PDF', reason: 'Standard document-format acronym.' },
  { file: 'src/ui/widgets/GitWorkbench.tsx', kind: 'expression', text: 'HEAD', reason: 'Git symbolic reference name.' },
  { file: 'src/ui/widgets/RemoteFileBrowser.tsx', kind: 'expression', text: 'new-folder', reason: 'Literal default folder-name value, not interface copy.' },
  { file: 'src/ui/widgets/RemoteFileBrowser.tsx', kind: 'expression', text: 'README.md', reason: 'Literal default file-name value, not interface copy.' },
  { file: 'src/ui/widgets/RuntimeMonitorPanel.tsx', kind: 'text', text: 'CPU', reason: 'Standard processor acronym.' },
  { file: 'src/ui/widgets/TerminalSettingsDialog.tsx', kind: 'text', text: '~/redeven', reason: 'Literal filesystem prompt path inside the terminal color preview.' },
  { file: 'src/ui/widgets/TerminalSettingsDialog.tsx', kind: 'text', text: '&gt;', reason: 'Literal terminal prompt symbol inside the terminal color preview.' },
  { file: 'src/ui/widgets/TerminalSettingsDialog.tsx', kind: 'text', text: 'pnpm dev', reason: 'Literal package-manager command inside the terminal color preview.' },
  { file: 'src/ui/widgets/TerminalSettingsDialog.tsx', kind: 'text', text: '200 12ms', reason: 'Literal HTTP status and latency sample inside the terminal color preview.' },
  { file: 'src/ui/workbench/redevenWorkbenchWidgets.tsx', kind: 'text', text: 'HTTP', reason: 'Standard protocol acronym.' },
];

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function isVisibleEnglish(value: string): boolean {
  const text = normalizeText(value);
  if (!text || /^(?:&(?:nbsp|ensp|emsp);)+$/u.test(text)) return false;
  return /[A-Za-z]{2}/u.test(text);
}

function sourceFiles(root: string): readonly string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'i18n' || entry.name === '__snapshots__') continue;
      files.push(...sourceFiles(resolved));
      continue;
    }
    if (!entry.name.endsWith('.tsx')) continue;
    if (/\.(?:test|spec|stories)\.tsx$/u.test(entry.name) || entry.name.includes('testHarness')) continue;
    files.push(resolved);
  }
  return files;
}

function findingsForFile(file: string): readonly Finding[] {
  const source = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const relativeFile = path.relative(process.cwd(), file).split(path.sep).join('/');
  const findings: Finding[] = [];

  const add = (kind: Finding['kind'], value: string): void => {
    const text = normalizeText(value);
    if (!isVisibleEnglish(text)) return;
    findings.push({ file: relativeFile, kind, text });
  };

  const addVisibleExpression = (expression: ts.Expression): void => {
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      add('expression', expression.text);
      return;
    }
    if (ts.isParenthesizedExpression(expression)) {
      addVisibleExpression(expression.expression);
      return;
    }
    if (ts.isConditionalExpression(expression)) {
      addVisibleExpression(expression.whenTrue);
      addVisibleExpression(expression.whenFalse);
      return;
    }
    if (
      ts.isBinaryExpression(expression)
      && (
        expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      )
    ) {
      addVisibleExpression(expression.left);
      addVisibleExpression(expression.right);
      return;
    }
    if (ts.isTemplateExpression(expression)) {
      const templateText = [expression.head.text, ...expression.templateSpans.map((span) => `{}${span.literal.text}`)].join('');
      add('expression', templateText);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) add('text', node.text);
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) addVisibleExpression(node.expression);
    if (
      ts.isJsxAttribute(node)
      && ts.isIdentifier(node.name)
      && VISIBLE_ATTRIBUTES.has(node.name.text)
      && node.initializer
    ) {
      if (ts.isStringLiteral(node.initializer)) {
        add(node.name.text as Finding['kind'], node.initializer.text);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        addVisibleExpression(node.initializer.expression);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

describe('hardcoded UI copy AST guard', () => {
  it('requires visible JSX English to use i18n or a precise explained exception', () => {
    const sourceRoot = path.resolve(process.cwd(), 'src/ui');
    const findings = sourceFiles(sourceRoot).flatMap(findingsForFile);
    const exceptionKeys = new Set(EXCEPTIONS.map(({ file, kind, text }) => `${file}\0${kind}\0${text}`));
    const findingKeys = new Set(findings.map(({ file, kind, text }) => `${file}\0${kind}\0${text}`));
    const violations = findings.filter(({ file, kind, text }) => !exceptionKeys.has(`${file}\0${kind}\0${text}`));
    const staleExceptions = EXCEPTIONS.filter(({ file, kind, text }) => !findingKeys.has(`${file}\0${kind}\0${text}`));

    expect(EXCEPTIONS.every((entry) => entry.reason.trim().length > 0)).toBe(true);
    expect(violations).toEqual([]);
    expect(staleExceptions).toEqual([]);
  });
});
