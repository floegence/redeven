import { cn } from '@floegence/floe-webapp-core'
import { ChevronRight } from '@floegence/floe-webapp-core/icons'
import { Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { useFileBrowser } from '@floegence/floe-webapp-core/file-browser'

import {
  buildFileBrowserPathSegments,
  resolveFileBrowserPathLayout,
  type FileBrowserPathSegment,
} from './fileBrowserPathLayout'

export interface FileBrowserPathBreadcrumbProps {
  class?: string
}

const PATH_BREADCRUMB_ITEM_BASE_CLASS =
  'text-xs px-1.5 py-0.5 rounded transition-all duration-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'
const PATH_BREADCRUMB_ANCESTOR_CLASS =
  'shrink-0 cursor-pointer text-muted-foreground hover:bg-muted/50 hover:text-foreground'
const PATH_BREADCRUMB_CURRENT_CLASS =
  'min-w-0 flex-1 cursor-default justify-start font-medium text-foreground'
const PATH_BREADCRUMB_ANCESTOR_TEXT_CLASS = 'block max-w-[8rem] truncate'
const PATH_BREADCRUMB_CURRENT_TEXT_CLASS = 'block min-w-0 truncate'

export function FileBrowserPathBreadcrumb(props: FileBrowserPathBreadcrumbProps) {
  const browser = useFileBrowser()
  let containerRef: HTMLElement | undefined
  let separatorMeasureRef: HTMLSpanElement | undefined
  let ellipsisMeasureRef: HTMLButtonElement | undefined
  const segmentMeasureRefs: Array<HTMLButtonElement | undefined> = []
  const [containerWidth, setContainerWidth] = createSignal(0)
  const [segmentWidths, setSegmentWidths] = createSignal<number[]>([])
  const [separatorWidth, setSeparatorWidth] = createSignal(16)
  const [ellipsisWidth, setEllipsisWidth] = createSignal(28)
  let frameHandle: number | undefined

  const segments = createMemo(() => buildFileBrowserPathSegments(browser.currentPath(), browser.homeLabel()))

  const syncMeasurements = () => {
    setContainerWidth(containerRef?.offsetWidth ?? 0)
    setSegmentWidths(segments().map((_, index) => segmentMeasureRefs[index]?.offsetWidth ?? 0))
    setSeparatorWidth(separatorMeasureRef?.offsetWidth ?? 16)
    setEllipsisWidth(ellipsisMeasureRef?.offsetWidth ?? 28)
  }

  const scheduleMeasurements = () => {
    if (typeof requestAnimationFrame !== 'function') {
      syncMeasurements()
      return
    }

    if (typeof frameHandle === 'number') {
      cancelAnimationFrame(frameHandle)
    }

    frameHandle = requestAnimationFrame(() => {
      frameHandle = undefined
      syncMeasurements()
    })
  }

  onMount(() => {
    scheduleMeasurements()

    if (typeof ResizeObserver === 'undefined' || !containerRef) return

    const observer = new ResizeObserver(() => {
      scheduleMeasurements()
    })
    observer.observe(containerRef)

    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    segments()
    scheduleMeasurements()
  })

  onCleanup(() => {
    if (typeof frameHandle === 'number') {
      cancelAnimationFrame(frameHandle)
    }
  })

  const layout = createMemo(() => resolveFileBrowserPathLayout({
    containerWidth: containerWidth(),
    segments: segments(),
    segmentWidths: segmentWidths(),
    separatorWidth: separatorWidth(),
    ellipsisWidth: ellipsisWidth(),
  }))

  const handleSegmentSelect = (segment: FileBrowserPathSegment) => {
    browser.setCurrentPath(segment.path)
  }

  return (
    <nav
      ref={containerRef}
      class={cn('relative flex min-w-0 items-center gap-1 overflow-hidden', props.class)}
      aria-label="Breadcrumb"
    >
      <For each={layout().visible}>
        {(segment, index) => (
          <>
            <Show when={index() > 0}>
              <ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground/50" />
            </Show>
            <Show when={layout().shouldCollapse && index() === 1}>
              <CollapsedSegments
                segments={layout().collapsed}
                onSelect={handleSegmentSelect}
              />
              <ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground/50" />
            </Show>
            <PathBreadcrumbItem
              segment={segment}
              isLast={index() === layout().visible.length - 1}
              onClick={() => handleSegmentSelect(segment)}
            />
          </>
        )}
      </For>

      <div class="pointer-events-none absolute left-0 top-0 h-0 overflow-hidden whitespace-nowrap opacity-0" aria-hidden="true">
        <For each={segments()}>
          {(segment, index) => (
            <button
              ref={(el) => {
                segmentMeasureRefs[index()] = el
              }}
              type="button"
              tabindex={-1}
              class={cn(PATH_BREADCRUMB_ITEM_BASE_CLASS, PATH_BREADCRUMB_ANCESTOR_CLASS)}
            >
              <span class={PATH_BREADCRUMB_ANCESTOR_TEXT_CLASS}>{segment.name}</span>
            </button>
          )}
        </For>
        <span
          ref={separatorMeasureRef}
          class="inline-flex h-3 w-3 items-center justify-center"
        >
          <ChevronRight class="h-3 w-3" />
        </span>
        <button
          ref={ellipsisMeasureRef}
          type="button"
          tabindex={-1}
          class={cn(PATH_BREADCRUMB_ITEM_BASE_CLASS, PATH_BREADCRUMB_ANCESTOR_CLASS)}
        >
          …
        </button>
      </div>
    </nav>
  )
}

interface CollapsedSegmentsProps {
  segments: FileBrowserPathSegment[]
  onSelect: (segment: FileBrowserPathSegment) => void
}

function CollapsedSegments(props: CollapsedSegmentsProps) {
  const items = createMemo<DropdownItem[]>(() => props.segments.map((segment) => ({
    id: segment.path,
    label: segment.name,
  })))

  const handleSelect = (path: string) => {
    const segment = props.segments.find((item) => item.path === path)
    if (segment) {
      props.onSelect(segment)
    }
  }

  return (
    <Dropdown
      trigger={(
        <button
          type="button"
          class={cn(PATH_BREADCRUMB_ITEM_BASE_CLASS, PATH_BREADCRUMB_ANCESTOR_CLASS)}
          title="Show hidden path segments"
        >
          …
        </button>
      )}
      items={items()}
      onSelect={handleSelect}
      align="start"
    />
  )
}

interface PathBreadcrumbItemProps {
  segment: FileBrowserPathSegment
  isLast: boolean
  onClick: () => void
}

function PathBreadcrumbItem(props: PathBreadcrumbItemProps) {
  return (
    <button
      type="button"
      onClick={() => props.onClick()}
      disabled={props.isLast}
      class={cn(
        PATH_BREADCRUMB_ITEM_BASE_CLASS,
        props.isLast ? PATH_BREADCRUMB_CURRENT_CLASS : PATH_BREADCRUMB_ANCESTOR_CLASS,
      )}
    >
      <span class={props.isLast ? PATH_BREADCRUMB_CURRENT_TEXT_CLASS : PATH_BREADCRUMB_ANCESTOR_TEXT_CLASS}>
        {props.segment.name}
      </span>
    </button>
  )
}
