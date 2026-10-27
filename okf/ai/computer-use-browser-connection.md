---
type: Product Interaction Contract
title: Guided personal browser connection
description: Prepare, install and confirm a same-host browser connection without exposing native-host configuration.
tags: [ai, browser-use, chrome, onboarding]
timestamp: 2026-09-27T00:00:00Z
lifecycle: contract
reviewed_at: "2026-10-22"
---
# Summary

Desktop and Env App share one personal browser connection guide. ComputerUseRuntime owns
connections; Floret ask_user and Respond remain the conversation owners.
The guide is bounded UI observation, not a second execution lifecycle. Users confirm installation and the first connection in Chrome; that profile then restores the same environment connection after restarts. Routine tasks reuse the verified connection without manually selecting a target.

# Contract

The browser connection guide opens from canonical conversation assistance.

Updating an unpacked extension loads the current visible folder with the same extension key; it does not require clearing browser profiles.

# Boundaries

Installation and connection never grant website access or authorize a tab. Uncertain tool effects, private pixels and explicit Stop keep their existing boundaries.

# Evidence

- `redeven:internal/ai/computer_extension_onboarding.go` - fixed native destinations and stable package staging.

- `redeven:internal/ai/computer_extension_onboarding_test.go` - destination rejection, sandbox arguments and installation replacement.
