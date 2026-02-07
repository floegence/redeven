# Local UI localhost Codespace Checklist

## A. Scope Lock

- [ ] Keep Local UI codespace URL in localhost form (`127.0.0.1:<port>`).
- [ ] Do not reintroduce `cs-*.localhost` in Local UI flow.
- [ ] Keep standard remote origin model (`env-`/`cs-`/`pf-`) unchanged.

## B. Design Alignment (before coding)

- [ ] Confirm `SpaceStatus.code_port` semantics in Local UI mode = browser access port.
- [ ] Confirm entry proxy lifecycle (start/stop/delete/close) ownership in `codeapp.Service`.
- [ ] Confirm Service Worker hardening rule: strip `Service-Worker-Allowed` only for code-server PWA SW script response.

## C. Implementation Tasks

### C1. Local entry proxy manager

- [ ] Add manager for `code_space_id -> entry_port + backend_port + proxy` mapping.
- [ ] Add ensure/start API used by `StartSpace`.
- [ ] Add stop/remove API used by `StopSpace`/`DeleteSpace`/`Close`.

### C2. Backend integration

- [ ] Wire manager into `internal/codeapp/codeapp.go` service init and shutdown.
- [ ] Update `internal/codeapp/backend.go` `StartSpace` to return entry port in Local UI mode.
- [ ] Update `internal/codeapp/backend.go` `ListSpaces` to surface entry port when running in Local UI mode.

### C3. Proxy request/response policy

- [ ] Reverse proxy to backend code-server loopback port.
- [ ] Keep outbound `Host`/`Origin` aligned with entry origin.
- [ ] Drop `Forwarded` and `X-Forwarded-*` headers.
- [ ] Remove `Service-Worker-Allowed` from PWA SW script responses.

### C4. Env UI touchpoints

- [ ] Keep Local UI open path in `EnvCodespacesPage.tsx` as localhost + `code_port`.
- [ ] Confirm no Local UI domain host generation remains.

## D. Tests

- [ ] Add unit tests for PWA SW header stripping behavior.
- [ ] Add unit tests for Local UI `StartSpace/ListSpaces` returning entry port.
- [ ] Add lifecycle tests: stop/delete/close release proxy listeners.

## E. Manual Verification

- [ ] Open codespace from Local UI and verify address bar is localhost.
- [ ] Check `navigator.serviceWorker.controller?.scriptURL` is not code-server PWA SW after settle.
- [ ] Check `navigator.serviceWorker.getRegistrations()` does not keep stale broad-scope code-server PWA SW.
- [ ] Verify file create no long pending under normal workload.
- [ ] Verify stop/delete codespace clears its entry proxy port.

## F. Quality Gate

- [ ] Run `go test ./...` in `redeven-agent`.
- [ ] Run `golangci-lint run ./...` in `redeven-agent`.
- [ ] Ensure no unrelated file changes in worktree.

## G. Merge & Cleanup (per `.develop.md`)

- [ ] In feature worktree: `git fetch origin` then one final `git rebase origin/main`.
- [ ] Resolve conflicts only in feature worktree.
- [ ] Re-run quality gate after rebase.
- [ ] Merge to `main` from main workspace with `--no-ff`.
- [ ] Push `origin/main`.
- [ ] Remove worktree directory and delete local/remote feature branch.

