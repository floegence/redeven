import { describe, expect, it } from 'vitest'

import {
  GIT_CHANGES_HEADER_COMFORTABLE_MIN_WIDTH,
  GIT_CHANGES_HEADER_COMPACT_MIN_WIDTH,
  buildGitChangesHeaderPresentation,
  resolveGitChangesBreadcrumbLayout,
  resolveGitChangesHeaderDensity,
} from './gitChangesHeaderLayout'

describe('gitChangesHeaderLayout', () => {
  it('defaults to the collapsed density before a stable measurement exists', () => {
    expect(resolveGitChangesHeaderDensity(0)).toBe('collapsed')
  })

  it('keeps narrow widths collapsed, medium widths compact, and wide widths comfortable', () => {
    expect(resolveGitChangesHeaderDensity(GIT_CHANGES_HEADER_COMPACT_MIN_WIDTH - 1)).toBe('collapsed')
    expect(resolveGitChangesHeaderDensity(GIT_CHANGES_HEADER_COMPACT_MIN_WIDTH)).toBe('compact')
    expect(resolveGitChangesHeaderDensity(GIT_CHANGES_HEADER_COMFORTABLE_MIN_WIDTH - 1)).toBe('compact')
    expect(resolveGitChangesHeaderDensity(GIT_CHANGES_HEADER_COMFORTABLE_MIN_WIDTH)).toBe('comfortable')
  })

  it('prefers breadcrumb segments nearest the current directory when space is limited', () => {
    const layout = resolveGitChangesBreadcrumbLayout({
      containerWidth: 276,
      segments: [
        { label: 'repo', path: '' },
        { label: 'desktop', path: 'desktop' },
        { label: 'workbench', path: 'desktop/workbench' },
        { label: 'dialogs', path: 'desktop/workbench/dialogs' },
        { label: 'routing', path: 'desktop/workbench/dialogs/routing' },
      ],
      segmentWidths: [40, 68, 84, 72, 60],
      separatorWidth: 12,
      ellipsisWidth: 28,
    })

    expect(layout.shouldCollapse).toBe(true)
    expect(layout.collapsed.map((segment) => segment.label)).toEqual(['desktop', 'workbench'])
    expect(layout.visible.map((segment) => segment.label)).toEqual(['repo', 'dialogs', 'routing'])
  })

  it('keeps clean-state headers quiet and actionable', () => {
    const presentation = buildGitChangesHeaderPresentation({
      density: 'comfortable',
      selectedSection: 'changes',
      visibleCount: 0,
      stagedCount: 0,
      canBulkAction: false,
      canDiscardAll: false,
      canOpenStash: true,
      canOpenInTerminal: true,
      canBrowseFiles: true,
      canAskFlower: false,
    })

    expect(presentation.title).toBe('Clean')
    expect(presentation.countBadgeLabel).toBe('No pending changes')
    expect(presentation.layoutMode).toBe('quiet_inline')
    expect(presentation.primaryActionIds).toEqual(['stash'])
    expect(presentation.utilityActionIds).toEqual(['terminal', 'files'])
    expect(presentation.overflowActionIds).toEqual([])
    expect(presentation.showSummaryCopy).toBe(false)
  })

  it('pushes low-priority utilities into overflow in compact and collapsed densities', () => {
    const compact = buildGitChangesHeaderPresentation({
      density: 'compact',
      selectedSection: 'changes',
      visibleCount: 6,
      stagedCount: 2,
      canBulkAction: true,
      canDiscardAll: true,
      canOpenStash: true,
      canOpenInTerminal: true,
      canBrowseFiles: true,
      canAskFlower: true,
    })

    expect(compact.layoutMode).toBe('default')
    expect(compact.primaryActionIds).toEqual(['commit', 'bulk', 'stash'])
    expect(compact.utilityActionIds).toEqual(['terminal', 'files'])
    expect(compact.overflowActionIds).toEqual(['discard', 'flower'])

    const collapsed = buildGitChangesHeaderPresentation({
      density: 'collapsed',
      selectedSection: 'changes',
      visibleCount: 6,
      stagedCount: 2,
      canBulkAction: true,
      canDiscardAll: true,
      canOpenStash: true,
      canOpenInTerminal: true,
      canBrowseFiles: true,
      canAskFlower: true,
    })

    expect(collapsed.layoutMode).toBe('default')
    expect(collapsed.primaryActionIds).toEqual(['commit', 'bulk', 'stash'])
    expect(collapsed.utilityActionIds).toEqual([])
    expect(collapsed.overflowActionIds).toEqual(['discard', 'terminal', 'files', 'flower'])
  })
})
