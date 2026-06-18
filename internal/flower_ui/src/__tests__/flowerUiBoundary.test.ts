import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { localizedFlowerProviderModelNote } from '../settings/providerModelNotes';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const flowerRoot = path.join(repoRoot, 'internal', 'flower_ui', 'src');

function readText(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    if (!/\.(ts|tsx|css)$/.test(entry.name)) return [];
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return [];
    return [full];
  });
}

describe('shared Flower UI boundary', () => {
  it('does not import Env runtime RPC, Desktop IPC, or runtime proxy endpoints', () => {
    const forbidden = [
      'useEnvContext',
      'useProtocol',
      'fetchLocalApiJSON',
      'prepareLocalApiRequestInit',
      'desktopSettingsBridge',
      'redevenDesktopSettings',
      '/_redeven_proxy',
      'electron',
    ];

    for (const file of listSourceFiles(flowerRoot)) {
      const src = readText(file);
      for (const token of forbidden) {
        expect(src, `${path.relative(repoRoot, file)} must not contain ${token}`).not.toContain(token);
      }
    }
  });

  it('keeps Redeven target routing fields out of the shared Flower surface contract', () => {
    const forbidden = [
      'current_target_id',
      'primary_target_id',
      'allowed_target_ids',
      'active_target_ids',
    ];
    const files = [
      path.join(flowerRoot, 'contracts', 'flowerSurfaceContracts.ts'),
      path.join(flowerRoot, 'FlowerSurface.tsx'),
      path.join(repoRoot, 'desktop', 'src', 'welcome', 'flower', 'localEnvironmentFlowerSurfaceAdapter.tsx'),
      path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'src', 'ui', 'flower', 'envLocalFlowerSurfaceAdapter.ts'),
    ];

    for (const file of files) {
      const src = readText(file);
      for (const token of forbidden) {
        expect(src, `${path.relative(repoRoot, file)} must not expose ${token}`).not.toContain(token);
      }
    }
  });

  it('keeps Desktop and Env App on the shared Flower surface styles and source scan', () => {
    const desktopCss = readText(path.join(repoRoot, 'desktop', 'src', 'welcome', 'index.css'));
    const envCss = readText(path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'src', 'index.css'));

    expect(desktopCss).toContain("../../../internal/flower_ui/src/styles/flower.css");
    expect(desktopCss).toContain("../../../internal/flower_ui/src/**/*.{ts,tsx,html}");
    expect(envCss).toContain("../../../flower_ui/src/styles/flower.css");
    expect(envCss).toContain("../../../flower_ui/src/**/*.{ts,tsx,html}");
  });

  it('keeps Desktop Welcome on the shared Flower surface and icon instead of the old inline panel', () => {
    const appSrc = readText(path.join(repoRoot, 'desktop', 'src', 'welcome', 'App.tsx'));

    expect(appSrc).toContain('copy={createDesktopFlowerSurfaceCopy(i18n())}');
    expect(appSrc).toContain("runtimeDisplayName: i18n().t('flowerSurface.runtime.localEnvironment')");
    expect(appSrc).toContain('<FlowerIcon class="h-5 w-5" />');
    expect(appSrc).toContain('createLocalEnvironmentFlowerSurfaceAdapter(');
    expect(appSrc).not.toContain('<FlowerNavigationIcon class="h-5 w-5" />');
    expect(appSrc).not.toContain('aria-label="Compose with Flower"');
    expect(appSrc).not.toContain('✿');
    expect(appSrc).not.toContain('placeholder="Ask Flower anything..."');
  });

  it('keeps the shared Flower sidebar as optional leading action plus New chat and thread list, not a section nav rail', () => {
    const surfaceSrc = readText(path.join(flowerRoot, 'FlowerSurface.tsx'));
    const cssSrc = readText(path.join(flowerRoot, 'styles', 'flower.css'));

    expect(surfaceSrc).toContain('flower-component-thread-rail');
    expect(surfaceSrc).toContain('sidebarLeadingAction?: JSX.Element');
    expect(surfaceSrc).toContain('{props.sidebarLeadingAction}');
    expect(cssSrc).toContain('.flower-sidebar-leading-action');
    expect(cssSrc).toContain('margin: 0.75rem 0.75rem 0.5rem;');
    expect(cssSrc).toContain('flex: 1 1 0;');
    expect(surfaceSrc).toContain('flower-new-chat-button');
    expect(surfaceSrc).toContain('flower-new-chat-label');
    expect(surfaceSrc).toContain('copy().chat.newChat');
    expect(surfaceSrc).toContain('<FlowerSoftAuraIcon');
    expect(surfaceSrc).toContain('<FlowerThreadList');
    expect(surfaceSrc).toContain('const returnToChat = () =>');
    expect(surfaceSrc).toContain('const openSettings = () =>');
    expect(surfaceSrc).toContain('const selectThread = (threadID: string) =>');
    expect(surfaceSrc).not.toContain("FlowerSurfacePanel = 'chat' | 'settings' | 'targets' | 'diagnostics'");
    expect(surfaceSrc).not.toContain('Available targets');
    expect(surfaceSrc).not.toContain('Diagnostics');
    expect(surfaceSrc).not.toContain('FlowerSidebarSettings');
    expect(surfaceSrc).not.toContain('FlowerRail');
    expect(surfaceSrc).not.toContain("sidePanel() === 'conversations'");
    expect(cssSrc).not.toContain('flower-component-entry-orb');
    expect(cssSrc).not.toContain('flower-component-nav-item');
  });

  it('keeps turn launching separate from the chat surface and removes draft injection contracts', () => {
    const surfaceSrc = readText(path.join(flowerRoot, 'FlowerSurface.tsx'));
    const contractsSrc = readText(path.join(flowerRoot, 'contracts', 'flowerSurfaceContracts.ts'));
    const launcherSrc = readText(path.join(flowerRoot, 'FlowerTurnLauncherWindow.tsx'));

    for (const token of ['draftIntent', 'FlowerSurfaceDraftIntent', 'activeDraftIntent', 'lastDraftIntentID']) {
      expect(surfaceSrc, `FlowerSurface must not contain ${token}`).not.toContain(token);
      expect(contractsSrc, `Flower contracts must not contain ${token}`).not.toContain(token);
    }
    for (const token of ['FlowerSendMessageInput', 'FlowerSendMessageFailure', 'sendMessage']) {
      expect(contractsSrc, `Flower contracts must not contain ${token}`).not.toContain(token);
    }
    expect(surfaceSrc).toContain('props.adapter.launchTurn');
    expect(contractsSrc).toContain('export type FlowerTurnLaunchInput');
    expect(contractsSrc).toContain('export type FlowerTurnLauncherIntent');
    expect(contractsSrc).toContain('source_surface');
    expect(contractsSrc).toContain('context_items');
    expect(contractsSrc).toContain('pending_attachments');
    expect(launcherSrc).toContain('onSubmit: (input: FlowerTurnLauncherSubmitInput) => Promise<void>');
    expect(launcherSrc).not.toContain('onSend');
  });

  it('keeps thread sidebar indicators as visual primitives instead of lifecycle color dots', () => {
    const modelSrc = readText(path.join(flowerRoot, 'threads', 'threadListModel.ts'));
    const cssSrc = readText(path.join(flowerRoot, 'styles', 'flower.css'));
    const staleVisuals = ['working', 'waiting', 'approval', 'success', 'failed', 'stopped', 'idle'];

    expect(modelSrc).toContain("visual: 'none' | 'wave' | 'dot'");
    for (const visual of staleVisuals) {
      expect(cssSrc).not.toContain(`data-flower-thread-indicator='${visual}'`);
    }
  });

  it('keeps Flower settings mounted and saves provider dialogs directly', () => {
    const surfaceSrc = readText(path.join(flowerRoot, 'FlowerSurface.tsx'));
    const settingsSrc = readText(path.join(flowerRoot, 'settings', 'FlowerSettingsSurface.tsx'));

    expect(surfaceSrc).toContain("sidePanel() !== 'settings' && 'hidden'");
    expect(settingsSrc).toContain('const confirmProviderDialog = async');
    expect(settingsSrc).toContain('const saved = await saveBuiltDraft(result);');
    expect(settingsSrc).not.toContain('Save provider draft');
  });

  it('keeps header Flower icons bare instead of using aura wrappers', () => {
    const appSrc = readText(path.join(repoRoot, 'desktop', 'src', 'welcome', 'App.tsx'));
    const envShellSrc = readText(path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'src', 'ui', 'EnvAppShell.tsx'));
    const surfaceSrc = readText(path.join(flowerRoot, 'FlowerSurface.tsx'));

    expect(appSrc).toContain('<FlowerIcon class="h-5 w-5" />');
    expect(envShellSrc).toContain('icon: FlowerNavigationIcon');
    expect(envShellSrc).not.toContain("activeTab === 'ai' && canUseFlower()");
    expect(surfaceSrc).toContain('<FlowerIcon class="h-5 w-5 text-primary" />');
    expect(surfaceSrc).not.toContain('<FlowerSoftAuraIcon class="h-5 w-5" />');
  });

  it('keeps shared Flower settings aligned with the pre-refactor AI settings structure', () => {
    const settingsSrc = readText(path.join(flowerRoot, 'settings', 'FlowerSettingsSurface.tsx'));
    const cssSrc = readText(path.join(flowerRoot, 'styles', 'flower.css'));

    expect(settingsSrc).toContain('flower-settings-current-model');
    expect(settingsSrc).toContain('flower-settings-policy-section');
    expect(settingsSrc).toContain('flower-settings-provider-gallery');
    expect(settingsSrc).toContain('FlowerProviderBrandIcon');
    expect(settingsSrc).toContain('FlowerAutoSaveIndicator');
    expect(settingsSrc).toContain('aria-label={copy().backToChat}');
    expect(settingsSrc).toContain('onBackToChat');
    expect(settingsSrc).not.toContain('Available target cache');
    expect(settingsSrc).not.toContain('role="button"');
    expect(settingsSrc).not.toContain('Save changes');
    expect(cssSrc).toContain('--flower-chat-surface: var(--redeven-surface-main, var(--background));');
    expect(cssSrc).toContain('flower-settings-current-model');
    expect(cssSrc).not.toContain('.flower-settings-provider-card {\\n  display: flex;\\n  min-width: 0;\\n  align-items: flex-start;\\n  gap: 0.75rem;\\n  border: 1px');
  });

  it('keeps Env App icon imports as re-exports from the shared Flower icon source', () => {
    const flowerIcon = readText(path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'src', 'ui', 'icons', 'FlowerIcon.tsx'));
    const auraIcon = readText(path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'src', 'ui', 'icons', 'FlowerSoftAuraIcon.tsx'));
    const providerIcons = readText(path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'src', 'ui', 'pages', 'settings', 'providerBrandIcons.ts'));
    const aiCatalog = readText(path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'src', 'ui', 'pages', 'settings', 'aiCatalog.ts'));

    expect(flowerIcon).toContain("flower_ui/src/icons/FlowerIcon");
    expect(auraIcon).toContain("flower_ui/src/icons/FlowerSoftAuraIcon");
    expect(providerIcons).toContain("flower_ui/src/settings/providerBrandIcons");
    expect(aiCatalog).toContain('FLOWER_PROVIDER_PRESETS');
  });

  it('keeps Flower provider model notes locale-aware across simplified and traditional Chinese', () => {
    expect(localizedFlowerProviderModelNote('zh-CN', 'openai_gpt_55_frontier')).toContain('复杂推理');
    expect(localizedFlowerProviderModelNote('zh-TW', 'openai_gpt_55_frontier')).toContain('複雜推理');
    expect(localizedFlowerProviderModelNote('zh-Hant', 'moonshot_kimi_k26')).toContain('內建 web search');
  });

  it('keeps Flower chat markdown separate from file preview markdown renderers', () => {
    const forbidden = [
      'FileMarkdown',
      'file-markdown',
      'MarkdownPreviewPane',
      'FilePreviewContext',
      'filePreviewItem',
      'buildRedevenFileResourceUrl',
      'markdownFileReference',
      'parseMarkdownLocalFileHref',
      'rendererVariant',
      'chat-md-file-ref',
      'frontmatter',
      'tableOfContents',
      'markdown-toc',
      'toc-',
      'katex',
      'mathPlugin',
      'marked-footnote',
      'marked-gfm-heading-id',
      '.fm-',
      '.file-markdown',
      '.chat-md-',
      '.codex-chat-markdown',
    ];

    for (const file of listSourceFiles(flowerRoot)) {
      const src = readText(file);
      for (const token of forbidden) {
        expect(src, `${path.relative(repoRoot, file)} must not contain ${token}`).not.toContain(token);
      }
    }
  });
});
