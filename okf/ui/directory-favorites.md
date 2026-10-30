---
type: Product Contract
title: Personal directory favorites
tags: [filesystem, ui, storage, security, desktop, flower]
lifecycle: contract
reviewed_at: "2026-10-30"
---
# Summary

Runtime owns one directory-favorites store. Each authenticated namespace, endpoint
and user has an independent ordered path set and revision. Env App and Desktop
supply this metadata to published Floe controlled pickers and filesystem menus; the
existing filesystem navigator remains the only path validation and selection owner.

# Contract

## Persistence and authentication
The Runtime opens apps/filesystem/directory-favorites.sqlite through sqliteutil before service readiness and closes it with Code App. Schema v1 is initialized transactionally; existing tables, objects and records are verified and unsupported or future schemas fail before a writable open.

There is no ten-item cap, automatic deletion, move tracking, grouping or custom naming.

## Client ownership and interaction
One in-memory client per authenticated environment supplies every mounted entry.

Initial load failure offers retry; refresh failure retains displayed paths.

No separate title card, second path line or persistent favorite star occupies the sidebar.

Files composes Home, Computer and favorites into one Quick access list, deduplicated by absolute path with authoritative root labels and permissions preserved. All entries share filtering and scrolling; roots are not pinned separately. Short lists use their natural height, capped at the smaller of 16rem and 45% of the sidebar body. The directory tree owns a separate viewport. Filtering appears above five entries, matches labels or full paths, holds the viewport height while active, and restores the previous list scroll on clear. Refresh retains rows, focus and the query. Arrow/Home/End navigation reveals only the local target, including in scaled Workbench windows. Menu invocation retains the captured directory and published focus ownership.

Published Sidebar owns the outer width; the Files/Git body fits its content box without a second fixed width or outer scroll owner.

Flower exposes favorites inside its directory picker. Conversation transcript and thread-list menus do not mutate directory favorites; their directory actions follow [working directory navigation](flower-working-directory-navigation.md).

## Compatibility
Runtime compatibility epoch 69 requires this exact authenticated resource and Desktop route allowlist. Floret APIs, domain schema, conversation lifecycle, file-operation authorization and Runtime Service protocol version remain unchanged.

# Boundaries

Favorites are personal navigation metadata owned by Redeven. Floret does not participate in this feature.

# Evidence

- redeven:internal/directoryfavorites/store.go — transactional scoped persistence and schema verification.

- redeven:internal/directoryfavorites/store_test.go — isolation, persistence, concurrency, rollback and invalid schemas.

- redeven:internal/codeapp/appserver/directory_favorites_api.go — authenticated read-only directory admission and item mutations.

- redeven:internal/envapp/ui_src/src/ui/widgets/FileBrowserQuickAccess.browser.test.tsx — compact geometry, 80-entry native scrolling, independent tree, filter/refresh continuity, scaled and short windows, menu focus, and every shipped locale.
