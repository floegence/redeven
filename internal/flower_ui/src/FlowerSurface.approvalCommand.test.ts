import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const stylesPath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'styles', 'flower.css');
const surfacePath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'FlowerSurface.tsx');

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function cssRule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end + 2);
}

describe('Flower approval command presentation', () => {
  it('uses a dedicated readable command font and token classes', () => {
    const css = readFile(stylesPath);
    const commandRule = cssRule(css, '.flower-approval-command-text');
    const codeRule = cssRule(css, '.flower-approval-command-code');
    const urlRule = cssRule(css, '.flower-approval-command-token-url');

    expect(commandRule).toContain('--flower-approval-command-font');
    expect(commandRule).toContain('Iosevka');
    expect(commandRule).toContain('JetBrains Mono');
    expect(commandRule).toContain('white-space: pre');
    expect(commandRule).toContain('overflow: auto');
    expect(commandRule).toContain('border: 0');
    expect(commandRule).toContain('box-shadow: none');
    expect(codeRule).toContain('font: inherit');
    expect(urlRule).toContain('text-decoration: none');
    expect(urlRule).not.toContain('underline');
    for (const token of ['command', 'flag', 'string', 'url', 'operator', 'variable']) {
      expect(css).toContain(`.flower-approval-command-token-${token}`);
    }
  });

  it('keeps approval copy and command rendering interactive without raw HTML injection', () => {
    const css = readFile(stylesPath);
    const copyRule = cssRule(css, '.flower-approval-copy-btn');
    const surface = readFile(surfacePath);

    expect(copyRule).toContain('cursor: pointer');
    expect(surface).toContain('aria-label={`${copy().chat.toolApprovalCopyCommand}${subtaskLabel()}`}');
    expect(surface).toContain('<FlowerShellCommandHighlight command={command()} />');
    expect(surface).toContain('pendingApprovalCommandForActivityItem(item(), selectedApprovalActions())');
    expect(surface).toContain('activityTitle(displayTitle())');
    expect(surface).toContain('subagentSummaries: selectedSubagentSummaries() ?? []');
    expect(surface).not.toContain('innerHTML');
  });

  it('describes open-world shell access without claiming every command uses the network', () => {
    const surface = readFile(surfacePath);

    expect(surface).toContain('copy().chat.toolApprovalOutsideWorkspaceRisk');
    expect(surface).not.toContain("notes.push('This command may access resources outside the workspace.')");
    expect(surface).not.toContain('This command accesses the network.');
  });

  it('uses independent Floe buttons for row and batch decisions', () => {
    const css = readFile(stylesPath);
    const surface = readFile(surfacePath);
    const actionsRule = cssRule(css, '.flower-approval-decision-group');
    const decisionRule = cssRule(css, '.flower-composer-approval-decision');

    expect(surface).toContain('const FlowerApprovalDecisionActions: Component<FlowerApprovalDecisionActionsProps>');
    expect(surface.match(/^\s+<FlowerApprovalDecisionActions/gmu)).toHaveLength(2);
    expect(surface).not.toContain('flower-approval-decision-divider');
    expect(actionsRule).toContain('gap: 0.5rem');
    expect(actionsRule).not.toContain('overflow: hidden');
    expect(decisionRule).toContain('border-radius: 9999px');
    expect(decisionRule).toContain('min-height: 2.25rem');
    expect(css).not.toContain('.flower-composer-approval-decision:focus-visible');
  });

  it('keeps complete operation descriptions readable and reserves the risk row for actual risk', () => {
    const css = readFile(stylesPath);
    const surface = readFile(surfacePath);

    expect(surface).toContain('class="flower-approval-operation-description"');
    expect(surface).not.toContain('presentation().risk');
    expect(cssRule(css, '.flower-approval-operation-description')).toContain('overflow-wrap: anywhere');
    expect(surface).toContain('<details class="flower-approval-details">');
  });
});
