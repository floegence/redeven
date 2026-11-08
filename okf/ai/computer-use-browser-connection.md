---
type: Product Interaction Contract
title: Guided personal browser connection
tags: [ai, browser-use, chrome, onboarding]
lifecycle: contract
reviewed_at: "2026-11-05"
---
# Summary

Desktop and Env App share browser connection guidance over ComputerUseRuntime and Floret interactions. Users confirm Chrome installation and initial binding; later sessions restore the same environment. Active failed operations retain connection_diagnostic:{phase:source_disconnected, reason} from their exact extension source lifetime.

# Contract

The browser connection guide opens from canonical conversation assistance.

Updating an unpacked extension loads the current visible folder with the same extension key; it does not require clearing browser profiles.

Native target_closed,
canceled_by_user, replaced_with_devtools and debugger_detached remain bounded
facts; unknown reasons become source_disconnected. They identify no actor and
prove neither delivery nor non-execution. Mutating exchange loss remains an
unknown effect; confirmed responses remain confirmed. Retirement matches
client/tab/binding, so a late event cannot poison a replacement or another tab. The same facts survive script failure and model text/structured encoding without
raw transport text, automatic reconnect, input replay or a second lifecycle store.

# Boundaries

Installation and connection never grant website access or authorize a tab. Uncertain tool effects, private pixels and explicit Stop keep their existing boundaries.

# Evidence

- `redeven:internal/ai/computer_extension_onboarding.go` - Source.
- `redeven:internal/ai/computer_extension_onboarding_test.go` - Tests.
