import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function read(relPath: string): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return fs.readFileSync(path.resolve(dir, relPath), 'utf8');
}

describe('git history layout wiring', () => {
  it('shares the explorer width storage key between files mode and git mode', () => {
    const src = read('./RemoteFileBrowser.tsx');

    expect(src).toContain("const PAGE_SIDEBAR_WIDTH_STORAGE_KEY = 'redeven:remote-file-browser:page-sidebar-width';");
    expect(src).toContain('sidebarWidthStorageKey={PAGE_SIDEBAR_WIDTH_STORAGE_KEY}');
    expect(src).toContain('width={gitHistorySidebarWidth()}');
    expect(src).toContain('resizable');
  });

  it('renders git workbench explorer through the native SidebarPane shell', () => {
    const src = read('./GitWorkbenchSidebar.tsx');

    expect(src).toContain("import { SidebarItem, SidebarItemList, SidebarPane } from '@floegence/floe-webapp-core/layout';");
    expect(src).toContain('title="Explorer"');
    expect(src).toContain('headerActions={<GitHistoryModeSwitch');
    expect(src).toContain('props.onClose?.();');
  });

  it('switches git subviews without awaiting a blocking refresh call', () => {
    const src = read('./RemoteFileBrowser.tsx');
    const start = src.indexOf('const handleGitSubviewChange = (view: GitWorkbenchSubview) => {');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = src.indexOf("const showPageSidebar = () => pageMode() === 'git';", start);
    expect(end).toBeGreaterThan(start);
    const handler = src.slice(start, end);

    expect(handler).toContain('setGitSubview(view);');
    expect(handler).not.toContain('refreshGitWorkbench');
    expect(handler).not.toContain('await ');
  });
});
