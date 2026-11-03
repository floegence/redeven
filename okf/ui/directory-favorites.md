---
type: Product Contract
title: Personal directory favorites
tags: [filesystem, ui, storage, security, desktop, flower]
lifecycle: contract
reviewed_at: "2026-10-30"
---
# Summary

Runtime stores independent ordered favorites/revisions per authenticated namespace/endpoint/user. Env App/Desktop supply metadata to published Floe pickers and menus; existing filesystem navigation alone validates/selects paths. Favorites neither grant authority nor duplicate navigation.

# Contract

## Persistence and authentication
The Runtime opens apps/filesystem/directory-favorites.sqlite through sqliteutil before service readiness and closes it with Code App. Schema v1 is initialized transactionally; existing tables, objects and records are verified and unsupported or future schemas fail before a writable open.

There is no ten-item cap, automatic deletion, move tracking, grouping or custom naming.

## Client ownership and interaction
One in-memory client per authenticated environment supplies every mounted entry.

Initial load failure offers retry; refresh failure retains displayed paths.

No separate title card, second path line or persistent favorite star occupies the sidebar.

Files composes Home, Computer and favorites into one Quick access list, deduplicated by absolute path with authoritative root labels and permissions preserved. All entries share filtering and scrolling; roots are not pinned separately. Short lists use their natural height, capped at the smaller of 16rem and 45% of the sidebar body. The directory tree owns a separate viewport. Filtering appears above five entries, matches labels or full paths, holds the viewport height while active, and restores the previous list scroll on clear. Refresh retains rows, focus and the query. Arrow/Home/End navigation reveals only the local target, including in scaled Workbench windows. Menu invocation retains the captured directory and published focus ownership.

Quick access marks only the exact active destination, never its containing root. The existing navigator supplies pending intent: selection and busy semantics update immediately; the progress icon appears only after 150ms of uninterrupted waiting to avoid fast-refresh flicker. Current-page semantics identify only the displayed path. Hover is weaker than selection; a leading marker distinguishes selection from focus. Selection never changes font weight, size or text geometry. Filtering never promotes another row to active.

The entire 32px-high shortcut row is a native navigation button, including padding and permission badges, except for the separate trailing 32px menu button. No dead gaps or overlapping actions divide these targets; pointer, keyboard and touch retain the same navigation/menu ownership.

Published Sidebar owns the outer width; the Files/Git body fits its content box without a second fixed width or outer scroll owner.

Flower exposes favorites inside its directory picker. Conversation transcript and thread-list menus do not mutate directory favorites; their directory actions follow [working directory navigation](flower-working-directory-navigation.md).

## Compatibility
Runtime compatibility epoch 69 requires this exact authenticated resource and Desktop route allowlist. Floret APIs, domain schema, conversation lifecycle, file-operation authorization and Runtime Service protocol version remain unchanged.

# Boundaries

Favorites are personal navigation metadata owned by Redeven. Floret does not participate in this feature.

# Evidence

- redeven:internal/directoryfavorites/store.go

- redeven:internal/directoryfavorites/store_test.go

- redeven:internal/codeapp/appserver/directory_favorites_api.go — authenticated read-only directory admission and item mutations.

- redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserQuickAccess.browser.test.tsx — compact geometry, full-row hit testing, 80-entry native scrolling, independent tree, filter/refresh continuity, scaled and short windows, menu focus, exclusive current/pending selection, stable text geometry, delayed progress, keyboard feedback, and every shipped locale.
