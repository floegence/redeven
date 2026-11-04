---
type: Execution Contract
title: Computer source detail and continuation reads
tags: [ai, computer-use, scripts, sources]
lifecycle: contract
reviewed_at: "2026-11-03"
---
# Summary

Source reads make original AX/DOM fields and descendants reachable beyond the
bounded default tree. [Read validation](computer-script-read-contract.md) owns
permissions, privacy and final publication; source detail does not bypass it or grant new target authority.

# Contract

locator.source() enumerates fields. Browser distinguishes AX and DOM; native
exposes AX attributes, actions and parameterized range reads. Long scalar values
return text/json chunks with Unicode-code-point offset/total, truncation and a
content-bound cursor. Child-reference collections return items/offset/total pages
(up to 200) from the existing ref owner. Changed source invalidates continuation;
empty, unavailable and unsupported values remain distinct. Source roles survive
the canonical guest projection. DOM reads explicitly include hidden/offscreen
facts and preserve URL query/fragment while removing credentials. Password/OTP
subtrees, including closed shadow roots, retain the privacy boundary. Source data
never grants iframe, filesystem, clipboard or application authority.

Browser AX child_refs retain ignored and DOM-less records as read-only refs in the existing owner; source reads validate AX/document identity without actionability. DOM-less records retain an ancestor privacy anchor and cannot authorize input. All declared child IDs must resolve or the read fails explicitly, never reports a false empty list.

No separate source store is introduced. Ref retention is bounded; read returned
refs before requesting distant pages. Source changes, detached DOM nodes and
replaced windows reject stale refs. A missing source fact is never synthesized.

# Boundaries

Source presence is not application readiness. Loaded facts cannot establish
virtualized or server-only content, and source roles never grant input authority.

# Evidence

Browser detail/complete-interaction tests, native SourceReadsTests and the
[qualification contract](computer-use-qualification.md) cover these paths.
