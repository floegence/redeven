import { describe, expect, it } from 'vitest'

import {
  FILE_BROWSER_WORKSPACE_INLINE_MIN_WIDTH,
  buildFileBrowserPathSegments,
  resolveFileBrowserPathLayout,
  resolveFileBrowserToolbarLayout,
} from './fileBrowserPathLayout'

describe('fileBrowserPathLayout', () => {
  it('builds breadcrumb segments from the current path and home label', () => {
    expect(buildFileBrowserPathSegments('/', 'Home')).toEqual([
      { name: 'Home', path: '/' },
    ])

    expect(buildFileBrowserPathSegments('/workspace/src/components', 'Home')).toEqual([
      { name: 'Home', path: '/' },
      { name: 'workspace', path: '/workspace' },
      { name: 'src', path: '/workspace/src' },
      { name: 'components', path: '/workspace/src/components' },
    ])
  })

  it('keeps middle directories visible when the container has enough width', () => {
    const segments = buildFileBrowserPathSegments('/workspace/customer-facing-platform/services/icons', 'Home')

    const layout = resolveFileBrowserPathLayout({
      containerWidth: 520,
      segments,
      segmentWidths: [44, 96, 88, 72, 80],
      separatorWidth: 12,
      ellipsisWidth: 28,
    })

    expect(layout.shouldCollapse).toBe(false)
    expect(layout.collapsed).toHaveLength(0)
    expect(layout.visible.map((segment) => segment.name)).toEqual([
      'Home',
      'workspace',
      'customer-facing-platform',
      'services',
      'icons',
    ])
  })

  it('prefers directories nearest the current path when width is limited', () => {
    const segments = buildFileBrowserPathSegments('/workspace/customer-facing-platform/services/runtime/assets/icons', 'Home')

    const layout = resolveFileBrowserPathLayout({
      containerWidth: 300,
      segments,
      segmentWidths: [44, 88, 92, 72, 68, 66, 80],
      separatorWidth: 12,
      ellipsisWidth: 28,
    })

    expect(layout.shouldCollapse).toBe(true)
    expect(layout.collapsed.map((segment) => segment.name)).toEqual([
      'workspace',
      'customer-facing-platform',
      'services',
      'runtime',
    ])
    expect(layout.visible.map((segment) => segment.name)).toEqual([
      'Home',
      'assets',
      'icons',
    ])
  })

  it('falls back to a first-plus-last layout when the container is very narrow', () => {
    const segments = buildFileBrowserPathSegments('/workspace/customer-facing-platform/services/icons', 'Home')

    const layout = resolveFileBrowserPathLayout({
      containerWidth: 180,
      segments,
      segmentWidths: [44, 96, 88, 72, 80],
      separatorWidth: 12,
      ellipsisWidth: 28,
    })

    expect(layout.shouldCollapse).toBe(true)
    expect(layout.collapsed.map((segment) => segment.name)).toEqual([
      'workspace',
      'customer-facing-platform',
      'services',
    ])
    expect(layout.visible.map((segment) => segment.name)).toEqual([
      'Home',
      'icons',
    ])
  })

  it('switches the workspace header into stacked mode below the inline width threshold', () => {
    expect(resolveFileBrowserToolbarLayout(FILE_BROWSER_WORKSPACE_INLINE_MIN_WIDTH)).toBe('inline')
    expect(resolveFileBrowserToolbarLayout(FILE_BROWSER_WORKSPACE_INLINE_MIN_WIDTH - 1)).toBe('stacked')
    expect(resolveFileBrowserToolbarLayout(FILE_BROWSER_WORKSPACE_INLINE_MIN_WIDTH + 40)).toBe('inline')
  })
})
