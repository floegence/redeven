import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveFromHere(relativePath: string): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), relativePath);
}

function readCodexCss(): string {
  return fs.readFileSync(resolveFromHere('./codex.css'), 'utf8');
}

function readCodexTranscript(): string {
  return fs.readFileSync(resolveFromHere('./CodexTranscript.tsx'), 'utf8');
}

function readCodexRunIndicator(): string {
  return fs.readFileSync(resolveFromHere('./CodexMessageRunIndicator.tsx'), 'utf8');
}

function readCodexActivityDetailPanel(): string {
  return fs.readFileSync(resolveFromHere('./CodexActivityDetailPanel.tsx'), 'utf8');
}

function readCodexFileChangeDiff(): string {
  return fs.readFileSync(resolveFromHere('./CodexFileChangeDiff.tsx'), 'utf8');
}

function readGitPatchViewer(): string {
  return fs.readFileSync(resolveFromHere('../widgets/GitPatchViewer.tsx'), 'utf8');
}

function readCodexActivityStream(): string {
  return fs.readFileSync(resolveFromHere('./CodexActivityStream.tsx'), 'utf8');
}

describe('Codex visual contract', () => {
  it('keeps codex.css on semantic flat surfaces without gradients', () => {
    const src = readCodexCss();

    expect(src).toContain('--codex-surface-page:');
    expect(src).toContain('--codex-surface-panel:');
    expect(src).toContain('--codex-surface-panel-subtle:');
    expect(src).toContain('--codex-surface-accent-subtle:');
    expect(src).toContain('--codex-surface-warning-subtle:');
    expect(src).toContain('--codex-border-default:');
    expect(src).toContain('--codex-border-accent:');
    expect(src).toContain('--codex-text-secondary:');
    expect(src).toContain('.codex-page-shell .chat-message-bubble-user {');
    expect(src).toContain('.codex-page-shell .chat-input-send-btn-active {');
    expect(src).toContain('.codex-chat-file-change {');
    expect(src).toMatch(/\.codex-activity-stream \{[\s\S]*width: min\(100%, 42rem\);[\s\S]*color: color-mix\(in srgb, var\(--muted-foreground\) 82%, var\(--foreground\) 18%\);/);
    expect(src).toMatch(/\.codex-activity-group-trigger,\s*\.codex-activity-item \{[\s\S]*background: transparent;[\s\S]*cursor: pointer;/);
    expect(src).toMatch(/\.codex-activity-item-list \{[\s\S]*padding-left: 1\.25rem;/);
    expect(src).toContain('.codex-activity-detail-panel {');
    expect(src).not.toContain('.codex-chat-evidence-card-web-search {');
    expect(src).not.toContain('.codex-chat-web-search-shell {');
    expect(src).not.toContain('.codex-chat-reasoning-toggle {');
    expect(src).not.toContain('.codex-chat-reasoning-card {');
    expect(src).not.toContain('.codex-chat-diff-pre {');
    expect(src).not.toContain('.codex-chat-file-change-viewport {');
    expect(src).not.toContain('.codex-chat-file-change-canvas {');
    expect(src).not.toContain('.codex-chat-file-change-kind-added {');
    expect(src).not.toContain('.codex-chat-markdown-block .chat-md-file-ref {');
  });

  it('scopes Codex file path and inline code emphasis without changing the shared patch viewer', () => {
    const css = readCodexCss();
    const detailPanelSrc = readCodexActivityDetailPanel();
    const fileChangeDiffSrc = readCodexFileChangeDiff();
    const gitPatchViewerSrc = readGitPatchViewer();

    expect(css).toContain('--codex-file-path-fg:');
    expect(css).toContain('--codex-file-path-hover-fg:');
    expect(css).toContain('--codex-inline-code-bg:');
    expect(css).toContain('--codex-inline-code-border:');
    expect(css).toMatch(/\.codex-activity-file-path \{[\s\S]*color: var\(--codex-file-path-fg\);[\s\S]*\}/);
    expect(css).toMatch(
      /\.codex-activity-detail-title\[data-codex-activity-detail-title='file_diff'\],\s*\.codex-activity-detail-title\[data-codex-activity-detail-title='file_preview'\] \{[\s\S]*color: var\(--codex-file-path-fg\);[\s\S]*font-family: ui-monospace/
    );
    expect(css).toMatch(/\.codex-activity-detail-markdown \.chat-md-file-ref \{[\s\S]*color: var\(--codex-file-path-fg\);/);
    expect(css).toMatch(/\.codex-chat-markdown-block \.chat-md-inline-code \{[\s\S]*background: var\(--codex-inline-code-bg\);/);
    expect(css).toMatch(/\.codex-chat-markdown-block \.chat-md-link \{[\s\S]*color: var\(--redeven-link-fg\);[\s\S]*cursor: pointer;/);
    expect(css).toMatch(/\.codex-chat-markdown-block \.chat-md-link \.chat-md-inline-code \{[\s\S]*background: var\(--redeven-link-code-bg\);[\s\S]*color: inherit;/);
    expect(css).not.toContain('.codex-chat-file-change-path');
    expect(css).not.toContain('.git-patch-file-path');
    expect(detailPanelSrc).toContain('data-codex-activity-detail-title={props.detail.type}');
    expect(fileChangeDiffSrc).not.toContain('pathClass');
    expect(gitPatchViewerSrc).not.toContain('pathClass');
  });

  it('keeps the Codex running indicator to a single accessible shimmer label', () => {
    const css = readCodexCss();
    const indicatorSrc = readCodexRunIndicator();

    expect(indicatorSrc).toContain('role="status"');
    expect(indicatorSrc).toContain('aria-live="polite"');
    expect(indicatorSrc).toContain('codex-message-run-indicator-label');
    expect(indicatorSrc).toContain("'Thinking'");
    expect(indicatorSrc).not.toContain('<svg');
    expect(indicatorSrc).not.toContain('createUniqueId');
    expect(indicatorSrc).not.toContain('codex-message-run-indicator-graph');
    expect(indicatorSrc).not.toContain('codex-message-run-indicator-bars');
    expect(css).toContain('@keyframes codex-message-run-shimmer');
    expect(css).toMatch(/\.codex-message-run-indicator-label \{[\s\S]*background-clip: text;[\s\S]*animation: codex-message-run-shimmer/);
    expect(css).not.toContain('@keyframes codex-message-run-draw');
    expect(css).not.toContain('@keyframes codex-message-run-bar');
    expect(css).not.toContain('.codex-message-run-indicator-graph');
    expect(css).not.toContain('.codex-message-run-indicator-bars');
  });

  it('keeps the Codex empty hero visually centered without phantom bottom spacing', () => {
    const src = readCodexCss();

    expect(src).toMatch(/\.codex-transcript-shell \{[\s\S]*min-height: 100%;/);
    expect(src).toMatch(/\.codex-transcript-state \{[\s\S]*min-height: 100%;[\s\S]*justify-content: center;/);
    expect(src).toMatch(/\.codex-empty-hero \{[\s\S]*margin: 0;[\s\S]*text-align: center;/);
    expect(src).toMatch(/\.codex-empty-hero \+ \.codex-empty-suggestions \{[\s\S]*margin-top: 2rem;/);
    expect(src).not.toMatch(/@media \(max-width: 640px\) \{[\s\S]*\.codex-transcript-state \{[\s\S]*justify-content: flex-start;/);
  });

  it('keeps short transcript feeds anchored to the composer edge without changing empty-state centering', () => {
    const src = readCodexCss();

    expect(src).toMatch(/\.codex-transcript-shell-feed > \.codex-transcript-feed \{[\s\S]*margin-top: auto;/);
  });

  it('keeps header controls compact and wrap-friendly for narrow Codex layouts', () => {
    const src = readCodexCss();

    expect(src).toMatch(/\.codex-page-header-rail \{[\s\S]*max-width: min\(100%, 32rem\);[\s\S]*justify-content: flex-end;[\s\S]*flex-wrap: wrap;/);
    expect(src).toMatch(/\.codex-page-header-rail \.codex-page-header-action \{[\s\S]*width: auto;[\s\S]*height: 1\.5rem;[\s\S]*font-size: 0\.6875rem;/);
    expect(src).toMatch(/@media \(max-width: 960px\) \{[\s\S]*\.codex-page-header-main \{[\s\S]*flex-wrap: wrap;[\s\S]*\.codex-page-header-rail \{[\s\S]*justify-content: flex-start;/);
  });

  it('keeps the composer dock softly floating over the transcript tail', () => {
    const src = readCodexCss();

    expect(src).toContain('--flower-chat-transcript-overlay-bottom-inset: calc(7.5rem + env(safe-area-inset-bottom, 0px));');
    expect(src).toMatch(/\.codex-page-bottom-dock \{[^}]*background: transparent;/);
    expect(src).not.toMatch(/\.codex-page-bottom-dock \{[^}]*border-top:/);
    expect(src).toMatch(/\.codex-page-bottom-dock::before \{[^}]*box-shadow: 0 -20px 32px -28px/);
    expect(src).toMatch(/\.codex-chat-input\.chat-input-container \{[^}]*overflow: visible;[^}]*backdrop-filter: blur\(14px\);/);
    expect(src).toMatch(/\.codex-page-bottom-support-track \{[^}]*width: min\(100%, var\(--codex-transcript-lane-max-width\)\);/);
    expect(src).toMatch(/\.codex-page-bottom-support-track-thread \{[^}]*grid-template-columns: var\(--codex-transcript-avatar-size\) minmax\(0, 1fr\);/);
    expect(src).toMatch(/\.codex-page-bottom-support-content-thread \{[^}]*width: min\(100%, var\(--codex-transcript-content-max-width\)\);/);
    expect(src).toMatch(/\.codex-page-bottom-support-content-page \{[^}]*width: 100%;/);
    expect(src).toMatch(/\.codex-chat-popup-overlay \{[^}]*position: absolute;[^}]*bottom: calc\(100% \+ 0\.4375rem\);/);
    expect(src).toMatch(/\.codex-page-shell \.codex-chat-input-send-btn-stop\.chat-input-send-btn-active \{[^}]*background:/);
  });

  it('keeps composer metadata grouped by layout role and carrier semantics', () => {
    const src = readCodexCss();

    expect(src).toMatch(/\.codex-chat-input-meta-rail \{[^}]*position: relative;[^}]*justify-content: space-between;[^}]*flex-wrap: nowrap;/);
    expect(src).toMatch(/\.codex-chat-input-meta-group-context \{[^}]*justify-content: flex-start;/);
    expect(src).toMatch(/\.codex-chat-input-meta-group-strategy \{[^}]*align-items: center;[^}]*justify-content: flex-end;[^}]*gap: 0\.5rem;[^}]*flex-wrap: nowrap;/);
    expect(src).toMatch(/\.codex-chat-input-meta-subgroup \{[^}]*display: flex;[^}]*align-items: center;[^}]*gap: 0\.5rem;[^}]*flex-wrap: nowrap;/);
    expect(src).toMatch(/\.codex-chat-input-meta-subgroup-policies \{[^}]*margin-inline-start: auto;[^}]*flex-wrap: nowrap;/);
    expect(src).toMatch(/\.codex-chat-input-meta-measure \{[^}]*position: absolute;[^}]*visibility: hidden;[^}]*white-space: nowrap;/);
    expect(src).toMatch(/\.codex-chat-composer-more-button \{[^}]*cursor: pointer;[^}]*border:/);
    expect(src).toMatch(/\.codex-chat-composer-more-panel \{[^}]*position: absolute;[^}]*bottom: calc\(100% \+ 0\.5rem\);[^}]*display: grid;/);
    expect(src).toMatch(/\.codex-chat-composer-more-row \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(5\.5rem, auto\) minmax\(0, 1fr\);/);
    expect(src).not.toContain('@container codex-composer-meta');
    expect(src).not.toContain('@container codex-composer-strategy');
    expect(src).not.toMatch(/calc\(50% - 0\.1875rem\)/);
    expect(src).toMatch(/\.codex-chat-select-chip-policy \{[^}]*border-color:/);
    expect(src).toMatch(/\.codex-chat-select-chip-control-policy \{[^}]*padding: 0 1rem 0 0\.5rem !important;/);
    expect(src).toMatch(/\.codex-chat-draft-objects \{[^}]*flex-direction: column;/);
  });

  it('keeps Codex markdown blockquotes aligned with the floe-webapp quote block shape', () => {
    const src = readCodexCss();

    expect(src).toMatch(
      /\.codex-chat-markdown-block \.chat-md-blockquote \{[\s\S]*margin: 0\.5rem 0;[\s\S]*border-left-width: 2px;[\s\S]*border-left-color: color-mix\(in srgb, var\(--primary\) 70%, transparent\);[\s\S]*border-radius: 0 0\.375rem 0\.375rem 0;[\s\S]*background: color-mix\(in srgb, var\(--muted\) 50%, transparent\);[\s\S]*color: color-mix\(in srgb, var\(--foreground\) 80%, transparent\);[\s\S]*font-style: normal;[\s\S]*padding: 0\.5rem 0\.75rem;[\s\S]*\}/
    );
  });

  it('keeps Codex user markdown block surfaces distinct from the dark user bubble', () => {
    const src = readCodexCss();

    expect(src).toMatch(
      /\.codex-chat-message-bubble-user \.codex-chat-markdown-block pre\.chat-md-code-block \{[\s\S]*background-color: color-mix\(in srgb, var\(--primary-foreground\) 92%, var\(--primary\) 8%\);[\s\S]*color: #1f2937;[\s\S]*\}/
    );
    expect(src).toMatch(
      /\.codex-chat-message-bubble-user \.codex-chat-markdown-block \.chat-md-blockquote \{[\s\S]*background: color-mix\(in srgb, var\(--primary-foreground\) 90%, var\(--primary\) 10%\);[\s\S]*color: #263041;[\s\S]*\}/
    );
    expect(src).not.toMatch(/\.codex-chat-message-bubble-user \.codex-chat-markdown-block pre\.chat-md-code-block \{[\s\S]*#0d1117/);
  });

  it('keeps empty and loading ornaments on the neutral Codex shell class', () => {
    const src = readCodexTranscript();
    const activityStreamSrc = readCodexActivityStream();

    expect(src.match(/class="codex-empty-ornament"/g)?.length ?? 0).toBe(1);
    expect(src).toContain('<CodexActivityStream');
    expect(activityStreamSrc).toContain('class="codex-activity-stream"');
    expect(activityStreamSrc).toContain('data-codex-activity-item-kind={item.kind}');
    expect(src).not.toContain('class="codex-chat-web-search-shell"');
    expect(src).not.toContain('class="codex-chat-web-search-meta"');
    expect(src).not.toContain('TranscriptEvidenceRowOldUnused');
    expect(src).toContain('data-codex-transcript-mode={transcriptSurfaceState().mode}');
    expect(src).toContain('class="codex-transcript-shell"');
    expect(src).not.toContain('bg-gradient-to-br');
  });
});
