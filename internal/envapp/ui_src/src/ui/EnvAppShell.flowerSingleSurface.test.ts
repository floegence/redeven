import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

describe('Env App Flower ownership', () => {
  it('keeps one retained EnvAIPage and lets Workbench provide only a host', () => {
    const shell = fs.readFileSync(path.join(uiRoot, 'EnvAppShell.tsx'), 'utf8');
    const widgets = fs.readFileSync(path.join(uiRoot, 'workbench', 'redevenWorkbenchWidgets.tsx'), 'utf8');

    const creationStart=shell.indexOf('const renderPluginCreation');
    const creationEnd=shell.indexOf('const [pluginWidgetCounts',creationStart);
    const creation=shell.slice(creationStart,creationEnd);
    expect(creation.match(/<EnvAIPage/g)).toHaveLength(1);
    expect(creation).toContain('embeddedConversation={options.embeddedConversation}');
    expect((shell.slice(0,creationStart)+shell.slice(creationEnd)).match(/<EnvAIPage/g)).toHaveLength(1);
    expect(shell).not.toContain('hidden={pluginCreationOpen()} inert={pluginCreationOpen()}');
    expect(shell).toContain('data-plugin-creation-content-host="activity"');
    expect(shell).toContain('data-plugin-creation-content-host="workbench"');
    expect(shell.match(/\{renderFlowerProduct\(\)\}/g)).toHaveLength(1);
    expect(shell.indexOf('{renderFlowerProduct()}')).toBeGreaterThan(shell.indexOf('{standalone ? renderStandalone() : renderMainShell()}'));
    expect(shell).toContain("flowerProductPlacement() === 'workbench'");
    expect(shell).toContain('setFlowerWorkbenchHost,');
    expect(widgets).not.toContain("import('../pages/EnvAIPage')");
    expect(widgets).not.toContain('<EnvAIPage');
    expect(widgets).toContain('data-flower-workbench-host');
    expect(widgets).toContain('env.setFlowerWorkbenchHost?.(target, true)');
  });
});
