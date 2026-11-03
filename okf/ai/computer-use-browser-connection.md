---
type: Product Interaction Contract
title: Guided personal browser connection
tags: [ai, browser-use, chrome, onboarding]
lifecycle: contract
reviewed_at: "2026-11-01"
---
# Summary

Desktop and Env App share browser connection guidance over ComputerUseRuntime and Floret interactions. Users confirm Chrome installation and initial binding; later sessions restore the same environment. This bounded observation UI owns neither execution nor another lifecycle, and verified connections are reused.

# Contract

The browser connection guide opens from canonical conversation assistance.

Updating an unpacked extension loads the current visible folder with the same extension key; it does not require clearing browser profiles.

# Boundaries

Installation and connection never grant website access or authorize a tab. Uncertain tool effects, private pixels and explicit Stop keep their existing boundaries.

# Evidence

- `redeven:internal/ai/computer_extension_onboarding.go` - Source.
- `redeven:internal/ai/computer_extension_onboarding_test.go` - Tests.
