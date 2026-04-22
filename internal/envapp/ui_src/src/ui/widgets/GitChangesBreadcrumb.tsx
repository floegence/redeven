import { ChevronRight } from '@floegence/floe-webapp-core/icons'
import { Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui'
import { cn } from '@floegence/floe-webapp-core'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'

import {
  resolveGitChangesBreadcrumbLayout,
  type GitChangesBreadcrumbSegment,
} from './gitChangesHeaderLayout'

export interface GitChangesBreadcrumbProps {
  segments: GitChangesBreadcrumbSegment[]
  onSelect?: (segment: GitChangesBreadcrumbSegment) => void
  onBrowseFiles?: (segment: GitChangesBreadcrumbSegment) => void | Promise<void>
  class?: string
}

const GIT_CHANGES_BREADCRUMB_SEGMENT_GROUP_CLASS =
  'inline-flex min-w-0 items-center gap-0.5'
const GIT_CHANGES_BREADCRUMB_ITEM_BASE_CLASS =
  'inline-flex min-w-0 items-center rounded-sm px-1 py-0.5 text-[11px] transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/70'
const GIT_CHANGES_BREADCRUMB_ANCESTOR_CLASS =
  'cursor-pointer text-foreground/90 underline-offset-2 hover:underline'
const GIT_CHANGES_BREADCRUMB_ANCESTOR_STATIC_CLASS =
  'cursor-default text-muted-foreground'
const GIT_CHANGES_BREADCRUMB_CURRENT_CLASS =
  'cursor-pointer font-medium text-foreground'
const GIT_CHANGES_BREADCRUMB_CURRENT_STATIC_CLASS =
  'cursor-default font-medium text-foreground'
const GIT_CHANGES_BREADCRUMB_LAUNCH_CLASS =
  'inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/65 transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/70'
const GIT_CHANGES_BREADCRUMB_TEXT_CLASS = 'block max-w-[10rem] truncate'

function GitBreadcrumbLaunchIcon(props: { class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden="true"
    >
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  )
}

function BreadcrumbEllipsis(props: { segments: GitChangesBreadcrumbSegment[]; onSelect?: (segment: GitChangesBreadcrumbSegment) => void }) {
  const items = createMemo<DropdownItem[]>(() => props.segments.map((segment, index) => ({
    id: `collapsed-${index}`,
    label: segment.label,
  })))

  const handleSelect = (itemId: string) => {
    const index = Number(itemId.replace('collapsed-', ''))
    const segment = props.segments[index]
    if (segment) {
      props.onSelect?.(segment)
    }
  }

  if (!props.onSelect) {
    return (
      <button
        type="button"
        disabled
        class={cn(GIT_CHANGES_BREADCRUMB_ITEM_BASE_CLASS, GIT_CHANGES_BREADCRUMB_ANCESTOR_STATIC_CLASS)}
        title="Hidden path segments"
      >
        …
      </button>
    )
  }

  return (
    <Dropdown
      trigger={(
        <button
          type="button"
          class={cn(GIT_CHANGES_BREADCRUMB_ITEM_BASE_CLASS, GIT_CHANGES_BREADCRUMB_ANCESTOR_CLASS)}
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

export function GitChangesBreadcrumb(props: GitChangesBreadcrumbProps) {
  let containerRef: HTMLElement | undefined
  let separatorMeasureRef: HTMLSpanElement | undefined
  let ellipsisMeasureRef: HTMLButtonElement | undefined
  const segmentMeasureRefs: Array<HTMLElement | undefined> = []
  const [containerWidth, setContainerWidth] = createSignal(0)
  const [segmentWidths, setSegmentWidths] = createSignal<number[]>([])
  const [separatorWidth, setSeparatorWidth] = createSignal(16)
  const [ellipsisWidth, setEllipsisWidth] = createSignal(28)
  let frameHandle: number | undefined

  const segments = createMemo(() => props.segments)

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

  const layout = createMemo(() => resolveGitChangesBreadcrumbLayout({
    containerWidth: containerWidth(),
    segments: segments(),
    segmentWidths: segmentWidths(),
    separatorWidth: separatorWidth(),
    ellipsisWidth: ellipsisWidth(),
  }))
  const canNavigate = () => typeof props.onSelect === 'function'
  const canBrowseFiles = () => typeof props.onBrowseFiles === 'function'
  const browseFilesTitle = (segment: GitChangesBreadcrumbSegment) => `Open ${segment.label} in Files`
  const browseFiles = (segment: GitChangesBreadcrumbSegment) => {
    void props.onBrowseFiles?.(segment)
  }

  return (
    <nav
      ref={containerRef}
      class={cn('relative flex min-w-0 items-center gap-1 overflow-hidden text-muted-foreground', props.class)}
      aria-label="Breadcrumb"
    >
      <For each={layout().visible}>
        {(segment, index) => (
          <>
            <Show when={index() > 0}>
              <ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground/50" />
            </Show>
            <Show when={layout().shouldCollapse && index() === 1}>
              <BreadcrumbEllipsis segments={layout().collapsed} onSelect={props.onSelect} />
              <ChevronRight class="h-3 w-3 shrink-0 text-muted-foreground/50" />
            </Show>
            <span class={GIT_CHANGES_BREADCRUMB_SEGMENT_GROUP_CLASS}>
              <button
                type="button"
                disabled={!canNavigate()}
                aria-current={index() === layout().visible.length - 1 ? 'page' : undefined}
                class={cn(
                  GIT_CHANGES_BREADCRUMB_ITEM_BASE_CLASS,
                  index() === layout().visible.length - 1
                    ? canNavigate()
                      ? GIT_CHANGES_BREADCRUMB_CURRENT_CLASS
                      : GIT_CHANGES_BREADCRUMB_CURRENT_STATIC_CLASS
                    : canNavigate()
                      ? GIT_CHANGES_BREADCRUMB_ANCESTOR_CLASS
                      : GIT_CHANGES_BREADCRUMB_ANCESTOR_STATIC_CLASS,
                )}
                onClick={() => props.onSelect?.(segment)}
              >
                <span class={GIT_CHANGES_BREADCRUMB_TEXT_CLASS}>{segment.label}</span>
              </button>
              <Show when={canBrowseFiles()}>
                <button
                  type="button"
                  aria-label={browseFilesTitle(segment)}
                  title={browseFilesTitle(segment)}
                  class={GIT_CHANGES_BREADCRUMB_LAUNCH_CLASS}
                  onClick={(event) => {
                    event.stopPropagation()
                    browseFiles(segment)
                  }}
                >
                  <GitBreadcrumbLaunchIcon class="h-2.5 w-2.5" />
                </button>
              </Show>
            </span>
          </>
        )}
      </For>

      <div class="pointer-events-none absolute left-0 top-0 h-0 overflow-hidden whitespace-nowrap opacity-0" aria-hidden="true">
        <For each={segments()}>
          {(segment, index) => (
            <span
              ref={(el) => {
                segmentMeasureRefs[index()] = el
              }}
              class={GIT_CHANGES_BREADCRUMB_SEGMENT_GROUP_CLASS}
            >
              <button
                type="button"
                tabindex={-1}
                class={cn(GIT_CHANGES_BREADCRUMB_ITEM_BASE_CLASS, GIT_CHANGES_BREADCRUMB_ANCESTOR_CLASS)}
              >
                <span class={GIT_CHANGES_BREADCRUMB_TEXT_CLASS}>{segment.label}</span>
              </button>
              <Show when={canBrowseFiles()}>
                <button
                  type="button"
                  tabindex={-1}
                  class={GIT_CHANGES_BREADCRUMB_LAUNCH_CLASS}
                >
                  <GitBreadcrumbLaunchIcon class="h-2.5 w-2.5" />
                </button>
              </Show>
            </span>
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
          class={cn(GIT_CHANGES_BREADCRUMB_ITEM_BASE_CLASS, GIT_CHANGES_BREADCRUMB_ANCESTOR_CLASS)}
        >
          …
        </button>
      </div>
    </nav>
  )
}
