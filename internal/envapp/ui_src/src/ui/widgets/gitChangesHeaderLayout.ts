import { workspaceViewSectionLabel, type GitWorkspaceViewSection } from '../utils/gitWorkbench'

export type GitChangesHeaderDensity = 'comfortable' | 'compact' | 'collapsed'
export type GitChangesHeaderLayoutMode = 'default' | 'quiet_inline'

export const GIT_CHANGES_HEADER_COMPACT_MIN_WIDTH = 620
export const GIT_CHANGES_HEADER_COMFORTABLE_MIN_WIDTH = 860
export const GIT_CHANGES_BREADCRUMB_CURRENT_MIN_WIDTH = 96

export interface GitChangesBreadcrumbSegment {
  label: string
  path: string
}

export interface GitChangesBreadcrumbLayoutOptions {
  containerWidth: number
  segments: GitChangesBreadcrumbSegment[]
  segmentWidths: number[]
  separatorWidth: number
  ellipsisWidth: number
  currentSegmentMinWidth?: number
}

export interface GitChangesBreadcrumbLayoutResult {
  visible: GitChangesBreadcrumbSegment[]
  collapsed: GitChangesBreadcrumbSegment[]
  shouldCollapse: boolean
}

export type GitChangesHeaderActionId =
  | 'commit'
  | 'bulk'
  | 'stash'
  | 'discard'
  | 'terminal'
  | 'files'
  | 'flower'

export interface GitChangesHeaderPresentationOptions {
  density: GitChangesHeaderDensity
  selectedSection: GitWorkspaceViewSection
  visibleCount: number
  stagedCount: number
  activeDirectoryPath?: string
  canBulkAction: boolean
  canDiscardAll: boolean
  canOpenStash: boolean
  canOpenInTerminal: boolean
  canBrowseFiles: boolean
  canAskFlower: boolean
}

export interface GitChangesHeaderPresentation {
  density: GitChangesHeaderDensity
  layoutMode: GitChangesHeaderLayoutMode
  title: string
  countBadgeLabel: string
  stagedBadgeLabel: string
  isCleanState: boolean
  summaryCopy: string
  showSummaryCopy: boolean
  primaryActionIds: GitChangesHeaderActionId[]
  utilityActionIds: GitChangesHeaderActionId[]
  overflowActionIds: GitChangesHeaderActionId[]
}

function fileCountLabel(count: number): string {
  return `${count} file${count === 1 ? '' : 's'}`
}

function headerSummaryCopy(options: GitChangesHeaderPresentationOptions, isCleanState: boolean): string {
  if (isCleanState) return ''
  if (options.selectedSection === 'staged') {
    return 'Review the staged snapshot before commit.'
  }
  if (options.selectedSection === 'changes' && options.visibleCount === 0 && options.stagedCount > 0) {
    return 'Pending changes are clear. Review the staged snapshot and commit when ready.'
  }
  if (options.selectedSection === 'changes' && String(options.activeDirectoryPath ?? '').trim()) {
    return 'Review this scope, then stage or discard.'
  }
  return 'Stage what you want to keep, then commit.'
}

function comfortablePrimaryActions(options: GitChangesHeaderPresentationOptions, canCommit: boolean): GitChangesHeaderActionId[] {
  const actions: GitChangesHeaderActionId[] = []
  if (options.canOpenStash) actions.push('stash')
  if (options.canDiscardAll) actions.push('discard')
  if (options.canBulkAction) actions.push('bulk')
  if (canCommit) actions.push('commit')
  return actions
}

function compactPrimaryActions(options: GitChangesHeaderPresentationOptions, canCommit: boolean): GitChangesHeaderActionId[] {
  const actions: GitChangesHeaderActionId[] = []
  if (canCommit) actions.push('commit')
  if (options.canBulkAction) actions.push('bulk')
  if (options.canOpenStash) actions.push('stash')
  return actions
}

function comfortableUtilityActions(options: GitChangesHeaderPresentationOptions): GitChangesHeaderActionId[] {
  const actions: GitChangesHeaderActionId[] = []
  if (options.canAskFlower) actions.push('flower')
  if (options.canOpenInTerminal) actions.push('terminal')
  if (options.canBrowseFiles) actions.push('files')
  return actions
}

function compactUtilityActions(options: GitChangesHeaderPresentationOptions): GitChangesHeaderActionId[] {
  const actions: GitChangesHeaderActionId[] = []
  if (options.canOpenInTerminal) actions.push('terminal')
  if (options.canBrowseFiles) actions.push('files')
  return actions
}

function compactOverflowActions(options: GitChangesHeaderPresentationOptions): GitChangesHeaderActionId[] {
  const actions: GitChangesHeaderActionId[] = []
  if (options.canDiscardAll) actions.push('discard')
  if (options.canAskFlower) actions.push('flower')
  return actions
}

function collapsedOverflowActions(options: GitChangesHeaderPresentationOptions): GitChangesHeaderActionId[] {
  const actions: GitChangesHeaderActionId[] = []
  if (options.canDiscardAll) actions.push('discard')
  if (options.canOpenInTerminal) actions.push('terminal')
  if (options.canBrowseFiles) actions.push('files')
  if (options.canAskFlower) actions.push('flower')
  return actions
}

export function resolveGitChangesHeaderDensity(width: number): GitChangesHeaderDensity {
  if (width >= GIT_CHANGES_HEADER_COMFORTABLE_MIN_WIDTH) return 'comfortable'
  if (width >= GIT_CHANGES_HEADER_COMPACT_MIN_WIDTH) return 'compact'
  return 'collapsed'
}

export function resolveGitChangesBreadcrumbLayout(options: GitChangesBreadcrumbLayoutOptions): GitChangesBreadcrumbLayoutResult {
  const { containerWidth, segments, segmentWidths, separatorWidth, ellipsisWidth } = options
  const currentSegmentMinWidth = Math.max(0, options.currentSegmentMinWidth ?? GIT_CHANGES_BREADCRUMB_CURRENT_MIN_WIDTH)

  if (
    segments.length <= 2
    || containerWidth <= 0
    || segmentWidths.length !== segments.length
    || segmentWidths.some((width) => width <= 0)
  ) {
    return {
      visible: segments,
      collapsed: [],
      shouldCollapse: false,
    }
  }

  const firstSegment = segments[0]
  const lastSegment = segments[segments.length - 1]
  const middleSegments = segments.slice(1, -1)
  const firstWidth = segmentWidths[0] ?? 0
  const middleWidths = segmentWidths.slice(1, -1)

  for (let visibleMiddleCount = middleSegments.length; visibleMiddleCount >= 0; visibleMiddleCount -= 1) {
    const collapsedCount = middleSegments.length - visibleMiddleCount
    let requiredWidth = firstWidth + separatorWidth + currentSegmentMinWidth

    if (collapsedCount > 0) {
      requiredWidth += separatorWidth + ellipsisWidth
    }

    const visibleMiddleWidths = middleWidths.slice(middleWidths.length - visibleMiddleCount)
    for (const width of visibleMiddleWidths) {
      requiredWidth += separatorWidth + width
    }

    if (requiredWidth <= containerWidth || visibleMiddleCount === 0) {
      const visibleMiddle = middleSegments.slice(middleSegments.length - visibleMiddleCount)
      const collapsed = middleSegments.slice(0, middleSegments.length - visibleMiddle.length)

      return {
        visible: [firstSegment, ...visibleMiddle, lastSegment],
        collapsed,
        shouldCollapse: collapsed.length > 0,
      }
    }
  }

  return {
    visible: [firstSegment, lastSegment],
    collapsed: middleSegments,
    shouldCollapse: true,
  }
}

export function buildGitChangesHeaderPresentation(options: GitChangesHeaderPresentationOptions): GitChangesHeaderPresentation {
  const isCleanState = options.selectedSection === 'changes' && options.visibleCount === 0 && options.stagedCount === 0
  const canCommit = options.stagedCount > 0

  if (options.density === 'comfortable') {
    return {
      density: options.density,
      layoutMode: isCleanState ? 'quiet_inline' : 'default',
      title: isCleanState ? 'Clean' : workspaceViewSectionLabel(options.selectedSection),
      countBadgeLabel: isCleanState ? 'No pending changes' : fileCountLabel(options.visibleCount),
      stagedBadgeLabel: `${options.stagedCount} staged`,
      isCleanState,
      summaryCopy: headerSummaryCopy(options, isCleanState),
      showSummaryCopy: !isCleanState,
      primaryActionIds: comfortablePrimaryActions(options, canCommit),
      utilityActionIds: comfortableUtilityActions(options),
      overflowActionIds: [],
    }
  }

  if (options.density === 'compact') {
    return {
      density: options.density,
      layoutMode: 'default',
      title: isCleanState ? 'Clean' : workspaceViewSectionLabel(options.selectedSection),
      countBadgeLabel: isCleanState ? 'No pending changes' : fileCountLabel(options.visibleCount),
      stagedBadgeLabel: `${options.stagedCount} staged`,
      isCleanState,
      summaryCopy: headerSummaryCopy(options, isCleanState),
      showSummaryCopy: false,
      primaryActionIds: compactPrimaryActions(options, canCommit),
      utilityActionIds: compactUtilityActions(options),
      overflowActionIds: compactOverflowActions(options),
    }
  }

  return {
    density: options.density,
    layoutMode: 'default',
    title: isCleanState ? 'Clean' : workspaceViewSectionLabel(options.selectedSection),
    countBadgeLabel: isCleanState ? 'No pending changes' : fileCountLabel(options.visibleCount),
    stagedBadgeLabel: `${options.stagedCount} staged`,
    isCleanState,
    summaryCopy: headerSummaryCopy(options, isCleanState),
    showSummaryCopy: false,
    primaryActionIds: compactPrimaryActions(options, canCommit),
    utilityActionIds: [],
    overflowActionIds: collapsedOverflowActions(options),
  }
}
