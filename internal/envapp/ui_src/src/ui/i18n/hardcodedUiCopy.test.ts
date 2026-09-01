import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type Finding = Readonly<{
  file: string;
  kind:
    | 'text'
    | 'expression'
    | 'title'
    | 'aria-label'
    | 'placeholder'
    | 'alt'
    | 'label'
    | 'message'
    | 'description'
    | 'detail'
    | 'tooltip'
    | 'eyebrow'
    | 'loadingLabel'
    | 'loadingStatus'
    | 'buttonLabel'
    | 'confirmLabel'
    | 'cancelLabel';
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
  { file: 'src/ui/debugConsole/DebugConsoleWindow.tsx', kind: 'text', text: 'collect_ui_metrics', reason: 'Raw event identifier shown by the diagnostic console.' },
  { file: 'src/ui/debugConsole/DebugConsoleWindow.tsx', kind: 'text', text: 'visible', reason: 'Raw lifecycle enum value in the diagnostic console.' },
  { file: 'src/ui/debugConsole/DebugConsoleWindow.tsx', kind: 'text', text: 'minimized', reason: 'Raw lifecycle enum value in the diagnostic console.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'docker.io/library/nginx:latest', reason: 'Literal OCI image reference example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'example/app:release', reason: 'Literal OCI image reference example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'no', reason: 'Docker restart-policy enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'always', reason: 'Docker restart-policy enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'unless-stopped', reason: 'Docker restart-policy enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'on-failure', reason: 'Docker restart-policy enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: '/usr/bin/env', reason: 'Literal executable-path example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'bash', reason: 'Literal executable argument example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'e.g. my-app', reason: 'Literal container-name example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: '/docker-entrypoint.sh', reason: 'Literal container executable-path example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: '--config', reason: 'Literal command argument example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'TCP', reason: 'Container port protocol enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'UDP', reason: 'Container port protocol enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'SCTP', reason: 'Container port protocol enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'expression', text: 'app-data', reason: 'Literal named-volume example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'expression', text: '/Users/me/data', reason: 'Literal host-path example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: '/data', reason: 'Literal container-path example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'noexec', reason: 'Tmpfs mount-option enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'nosuid', reason: 'Tmpfs mount-option enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'nodev', reason: 'Tmpfs mount-option enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'APP_ENV', reason: 'Literal environment-variable name example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'production', reason: 'Literal environment-variable value example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'MiB', reason: 'Binary size-unit symbol.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'GiB', reason: 'Binary size-unit symbol.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'bridge', reason: 'Container network-mode enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'host', reason: 'Container namespace-mode enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'private', reason: 'Container namespace-mode enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'com.example.role', reason: 'Literal container-label key example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'worker', reason: 'Literal container-label value example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'NET_ADMIN', reason: 'Linux capability enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'ALL', reason: 'Linux capability enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'no-new-privileges', reason: 'Container security-option literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: '/dev/ttyUSB0', reason: 'Literal Linux device-path example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'rwm', reason: 'Container device-permission enum literal.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'http://proxy.example.com:3128', reason: 'Literal HTTP proxy URL example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'https://proxy.example.com:3129', reason: 'Literal HTTPS proxy URL example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'placeholder', text: 'localhost,127.0.0.1,.example.com', reason: 'Literal NO_PROXY host-list example.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'currentContext', reason: 'Docker CLI configuration field name shown beside its localized label.' },
  { file: 'src/ui/pages/EnvContainersPage.tsx', kind: 'text', text: 'detachKeys', reason: 'Docker CLI configuration field name shown beside its localized label.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'placeholder', text: '/usr/local/bin/start', reason: 'Literal managed-container executable-path example.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'text', text: 'no', reason: 'Docker restart-policy enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'text', text: 'unless-stopped', reason: 'Docker restart-policy enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'text', text: 'always', reason: 'Docker restart-policy enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'text', text: 'on-failure', reason: 'Docker restart-policy enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'expression', text: '--listen 0.0.0.0', reason: 'Literal managed-container command argument example.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'placeholder', text: 'com.example.role', reason: 'Literal managed-container label-key example.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'placeholder', text: 'API_BASE_URL', reason: 'Literal managed-container environment-variable name example.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'text', text: 'workspace', reason: 'Managed-service mount-type enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'text', text: 'bind', reason: 'Docker mount-type enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'text', text: 'volume', reason: 'Docker mount-type enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'text', text: 'tmpfs', reason: 'Docker mount-type enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'expression', text: '/host/path', reason: 'Literal managed-container host-path example.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'expression', text: 'service-data', reason: 'Literal managed-container named-volume example.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'expression', text: 'rw,noexec,nosuid,nodev,size=536870912', reason: 'Literal tmpfs mount-options example.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'placeholder', text: '/workspace', reason: 'Literal managed-container target-path example.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'text', text: 'RO', reason: 'Standard read-only mount-mode abbreviation.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'placeholder', text: 'bridge', reason: 'Docker network-mode enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'placeholder', text: 'private', reason: 'Container namespace-mode enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'text', text: 'tcp', reason: 'Container port-protocol enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'text', text: 'udp', reason: 'Container port-protocol enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'placeholder', text: 'NET_ADMIN', reason: 'Linux capability enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'placeholder', text: 'ALL', reason: 'Linux capability enum literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'placeholder', text: 'no-new-privileges:true', reason: 'Container security-option literal.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'placeholder', text: '/dev/dri', reason: 'Literal Linux device-path example.' },
  { file: 'src/ui/pages/ManagedServiceSettingsDrawer.tsx', kind: 'placeholder', text: 'rwm', reason: 'Container device-permission enum literal.' },
  { file: 'src/ui/pages/ServiceTemplateCatalog.tsx', kind: 'label', text: 'SHA-256', reason: 'Standard cryptographic hash-algorithm name.' },
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
  { file: 'src/ui/plugins/PluginConfirmationQueue.tsx', kind: 'label', text: 'plugin_id', reason: 'Wire-protocol field name shown in technical details.' },
  { file: 'src/ui/plugins/PluginConfirmationQueue.tsx', kind: 'label', text: 'plugin_instance_id', reason: 'Wire-protocol field name shown in technical details.' },
  { file: 'src/ui/plugins/PluginConfirmationQueue.tsx', kind: 'label', text: 'surface_id', reason: 'Wire-protocol field name shown in technical details.' },
  { file: 'src/ui/plugins/PluginConfirmationQueue.tsx', kind: 'label', text: 'request_id', reason: 'Wire-protocol field name shown in technical details.' },
  { file: 'src/ui/plugins/PluginConfirmationQueue.tsx', kind: 'label', text: 'confirmation_token_id', reason: 'Wire-protocol field name shown in technical details.' },
  { file: 'src/ui/plugins/PluginConfirmationQueue.tsx', kind: 'label', text: 'method', reason: 'Wire-protocol field name shown in technical details.' },
  { file: 'src/ui/plugins/PluginConfirmationQueue.tsx', kind: 'label', text: 'request_hash', reason: 'Wire-protocol field name shown in technical details.' },
  { file: 'src/ui/plugins/PluginConfirmationQueue.tsx', kind: 'label', text: 'plan_hash', reason: 'Wire-protocol field name shown in technical details.' },
  { file: 'src/ui/plugins/PluginConfirmationQueue.tsx', kind: 'text', text: 'destructive', reason: 'Wire-protocol risk field shown as a security status.' },
  { file: 'src/ui/plugins/PluginConfirmationQueue.tsx', kind: 'text', text: 'data_loss', reason: 'Wire-protocol risk field shown as a security status.' },
  { file: 'src/ui/plugins/PluginConfirmationQueue.tsx', kind: 'text', text: 'data_loss_risk', reason: 'Wire-protocol risk field shown as a security status.' },
  { file: 'src/ui/plugins/PluginConfirmationQueue.tsx', kind: 'text', text: 'runtime.privileged', reason: 'Wire-protocol field name shown as a security status.' },
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
