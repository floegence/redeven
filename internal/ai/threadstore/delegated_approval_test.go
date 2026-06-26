package threadstore

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func openDelegatedApprovalTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "threads.sqlite"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func delegatedApprovalTestRecord(actionID string) DelegatedApprovalRecord {
	return DelegatedApprovalRecord{
		ActionID:            actionID,
		EndpointID:          "env_delegated",
		ParentThreadID:      "thread_parent",
		ParentRunID:         "run_parent",
		ParentTurnID:        "turn_parent",
		SubagentID:          "subagent_1",
		ChildThreadID:       "thread_child",
		ChildRunID:          "run_child",
		ChildTurnID:         "turn_child",
		ChildToolCallID:     "tool_child",
		ApprovalID:          "approval_child",
		RefHash:             "ref_hash_" + actionID,
		State:               "requested",
		Status:              "pending",
		DeliveryState:       "waiting_decision",
		ChildExecutionState: "pending",
		Version:             1,
		SurfaceEpoch:        1,
		RequestedAtUnixMs:   100,
		ExpiresAtUnixMs:     1000,
		ActionJSON:          `{"action_id":"` + actionID + `","state":"requested","status":"pending"}`,
		CreatedAtUnixMs:     100,
		UpdatedAtUnixMs:     100,
	}
}

func TestDelegatedApprovalStore_UpsertIsIdempotentForRepeatedAsk(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openDelegatedApprovalTestStore(t)
	rec := delegatedApprovalTestRecord("dappr_repeat")
	if err := store.UpsertDelegatedApprovalRequest(ctx, rec); err != nil {
		t.Fatalf("Upsert first: %v", err)
	}
	if err := store.UpsertDelegatedApprovalRequest(ctx, rec); err != nil {
		t.Fatalf("Upsert repeat: %v", err)
	}

	got, ok, err := store.GetDelegatedApprovalRequest(ctx, "env_delegated", "thread_parent", "dappr_repeat")
	if err != nil {
		t.Fatalf("GetDelegatedApprovalRequest: %v", err)
	}
	if !ok {
		t.Fatalf("delegated approval missing")
	}
	if got.Version != 1 || got.ActionJSON != `{"action_id":"dappr_repeat","state":"requested","status":"pending"}` {
		t.Fatalf("repeated ask rewrote record: version=%d action=%s", got.Version, got.ActionJSON)
	}
	var requestedEvents int
	if err := store.db.QueryRowContext(ctx, `SELECT count(*) FROM ai_delegated_approval_events WHERE action_id = ? AND event_type = 'requested'`, "dappr_repeat").Scan(&requestedEvents); err != nil {
		t.Fatalf("count requested events: %v", err)
	}
	if requestedEvents != 1 {
		t.Fatalf("requested event count=%d, want 1", requestedEvents)
	}
}

func TestDelegatedApprovalStore_UpsertFingerprintMismatchFailsClosed(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openDelegatedApprovalTestStore(t)
	rec := delegatedApprovalTestRecord("dappr_drift")
	if err := store.UpsertDelegatedApprovalRequest(ctx, rec); err != nil {
		t.Fatalf("Upsert first: %v", err)
	}
	rec.ActionJSON = `{"action_id":"dappr_drift","state":"requested","status":"pending","changed":true}`
	rec.Version = 9
	if err := store.UpsertDelegatedApprovalRequest(ctx, rec); err == nil || !strings.Contains(err.Error(), "fingerprint mismatch") {
		t.Fatalf("Upsert drift error=%v, want fingerprint mismatch", err)
	}

	got, ok, err := store.GetDelegatedApprovalRequest(ctx, "env_delegated", "thread_parent", "dappr_drift")
	if err != nil {
		t.Fatalf("GetDelegatedApprovalRequest: %v", err)
	}
	if !ok || got.State != "unavailable" || got.Status != "unavailable" || got.DeliveryState != "delivery_unavailable" {
		t.Fatalf("record after drift=%#v, want unavailable", got)
	}
	var mismatchEvents int
	if err := store.db.QueryRowContext(ctx, `SELECT count(*) FROM ai_delegated_approval_events WHERE action_id = ? AND event_type = 'request_fingerprint_mismatch'`, "dappr_drift").Scan(&mismatchEvents); err != nil {
		t.Fatalf("count mismatch events: %v", err)
	}
	if mismatchEvents != 1 {
		t.Fatalf("mismatch event count=%d, want 1", mismatchEvents)
	}
}

func TestDelegatedApprovalStore_ActionIDIsScopedByEndpointAndParentThread(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openDelegatedApprovalTestStore(t)
	first := delegatedApprovalTestRecord("dappr_same_action")
	first.EndpointID = "env_one"
	first.ParentThreadID = "thread_one"
	first.RefHash = "ref_one"
	first.ActionJSON = `{"action_id":"dappr_same_action","state":"requested","scope":"one"}`
	second := delegatedApprovalTestRecord("dappr_same_action")
	second.EndpointID = "env_two"
	second.ParentThreadID = "thread_two"
	second.RefHash = "ref_two"
	second.ActionJSON = `{"action_id":"dappr_same_action","state":"requested","scope":"two"}`
	if err := store.UpsertDelegatedApprovalRequest(ctx, first); err != nil {
		t.Fatalf("Upsert first scope: %v", err)
	}
	if err := store.UpsertDelegatedApprovalRequest(ctx, second); err != nil {
		t.Fatalf("Upsert second scope: %v", err)
	}

	gotFirst, ok, err := store.GetDelegatedApprovalRequest(ctx, "env_one", "thread_one", "dappr_same_action")
	if err != nil {
		t.Fatalf("Get first scope: %v", err)
	}
	if !ok || !strings.Contains(gotFirst.ActionJSON, `"scope":"one"`) {
		t.Fatalf("first scoped record=%#v, want scope one", gotFirst)
	}
	gotSecond, ok, err := store.GetDelegatedApprovalRequest(ctx, "env_two", "thread_two", "dappr_same_action")
	if err != nil {
		t.Fatalf("Get second scope: %v", err)
	}
	if !ok || !strings.Contains(gotSecond.ActionJSON, `"scope":"two"`) {
		t.Fatalf("second scoped record=%#v, want scope two", gotSecond)
	}
	var requestedEvents int
	if err := store.db.QueryRowContext(ctx, `
SELECT count(*)
FROM ai_delegated_approval_events
WHERE action_id = ? AND event_type = 'requested'
`, "dappr_same_action").Scan(&requestedEvents); err != nil {
		t.Fatalf("count requested events: %v", err)
	}
	if requestedEvents != 2 {
		t.Fatalf("requested events=%d, want 2", requestedEvents)
	}
}

func TestDelegatedApprovalStore_DecisionCASDeliveryAndIdempotency(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openDelegatedApprovalTestStore(t)
	rec := delegatedApprovalTestRecord("dappr_cas")
	if err := store.UpsertDelegatedApprovalRequest(ctx, rec); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	req := DelegatedApprovalDecisionRequest{
		EndpointID:       "env_delegated",
		ParentThreadID:   "thread_parent",
		ActionID:         "dappr_cas",
		Version:          1,
		SurfaceEpoch:     1,
		Approved:         true,
		NextVersion:      2,
		NextActionJSON:   `{"action_id":"dappr_cas","state":"approved","delivery_state":"delivery_pending"}`,
		ResolvedAtUnixMs: 200,
		ActorScope:       "env_delegated:user_1:thread_parent",
		IdempotencyKey:   "idem-1",
		ResponseJSON:     `{"ok":true}`,
	}
	result, err := store.SubmitDelegatedApprovalDecisionCAS(ctx, req)
	if err != nil {
		t.Fatalf("SubmitDelegatedApprovalDecisionCAS: %v", err)
	}
	if !result.Accepted || result.Replayed || result.Conflict {
		t.Fatalf("unexpected decision result: %#v", result)
	}
	got, ok, err := store.GetDelegatedApprovalRequest(ctx, "env_delegated", "thread_parent", "dappr_cas")
	if err != nil {
		t.Fatalf("Get after decision: %v", err)
	}
	if !ok || got.State != "approved" || got.Status != "resolved" || got.DeliveryState != "delivery_pending" || got.Version != 2 {
		t.Fatalf("record after decision=%#v", got)
	}

	replay, err := store.SubmitDelegatedApprovalDecisionCAS(ctx, req)
	if err != nil {
		t.Fatalf("Submit replay: %v", err)
	}
	if !replay.Accepted || !replay.Replayed || replay.Conflict {
		t.Fatalf("unexpected replay result: %#v", replay)
	}
	req.Approved = false
	conflict, err := store.SubmitDelegatedApprovalDecisionCAS(ctx, req)
	if err != nil {
		t.Fatalf("Submit conflicting idempotency: %v", err)
	}
	if !conflict.Conflict || conflict.Accepted {
		t.Fatalf("expected idempotency conflict, got %#v", conflict)
	}

	delivered, err := store.MarkDelegatedApprovalDelivered(ctx, "env_delegated", "thread_parent", "dappr_cas", 2, `{"action_id":"dappr_cas","state":"approved","delivery_state":"delivery_delivered"}`, 300)
	if err != nil {
		t.Fatalf("MarkDelegatedApprovalDelivered: %v", err)
	}
	if !delivered {
		t.Fatalf("delivery update did not apply")
	}
	got, ok, err = store.GetDelegatedApprovalRequest(ctx, "env_delegated", "thread_parent", "dappr_cas")
	if err != nil {
		t.Fatalf("Get after delivery: %v", err)
	}
	if !ok || got.DeliveryState != "delivery_delivered" {
		t.Fatalf("record after delivery=%#v", got)
	}
}

func TestDelegatedApprovalStore_StaleDecisionDoesNotChangeRecord(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openDelegatedApprovalTestStore(t)
	if err := store.UpsertDelegatedApprovalRequest(ctx, delegatedApprovalTestRecord("dappr_stale")); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	result, err := store.SubmitDelegatedApprovalDecisionCAS(ctx, DelegatedApprovalDecisionRequest{
		EndpointID:       "env_delegated",
		ParentThreadID:   "thread_parent",
		ActionID:         "dappr_stale",
		Version:          2,
		SurfaceEpoch:     1,
		Approved:         true,
		NextVersion:      3,
		NextActionJSON:   `{"action_id":"dappr_stale","state":"approved"}`,
		ResolvedAtUnixMs: 200,
	})
	if err != nil {
		t.Fatalf("Submit stale decision: %v", err)
	}
	if result.Accepted || result.Replayed || result.Conflict {
		t.Fatalf("stale decision changed state: %#v", result)
	}
	got, ok, err := store.GetDelegatedApprovalRequest(ctx, "env_delegated", "thread_parent", "dappr_stale")
	if err != nil {
		t.Fatalf("Get after stale decision: %v", err)
	}
	if !ok || got.State != "requested" || got.Status != "pending" || got.Version != 1 {
		t.Fatalf("record after stale decision=%#v", got)
	}
}

func TestDelegatedApprovalStore_ConcurrentDecisionsOnlyOneWins(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openDelegatedApprovalTestStore(t)
	if err := store.UpsertDelegatedApprovalRequest(ctx, delegatedApprovalTestRecord("dappr_race")); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	const workers = 8
	start := make(chan struct{})
	results := make(chan DelegatedApprovalDecisionResult, workers)
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			result, err := store.SubmitDelegatedApprovalDecisionCAS(ctx, DelegatedApprovalDecisionRequest{
				EndpointID:       "env_delegated",
				ParentThreadID:   "thread_parent",
				ActionID:         "dappr_race",
				Version:          1,
				SurfaceEpoch:     1,
				Approved:         i%2 == 0,
				NextVersion:      2,
				NextActionJSON:   `{"action_id":"dappr_race","state":"decided"}`,
				ResolvedAtUnixMs: int64(200 + i),
			})
			if err != nil {
				errs <- err
				return
			}
			results <- result
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent decision error: %v", err)
	}
	accepted := 0
	for result := range results {
		if result.Accepted {
			accepted++
		}
	}
	if accepted != 1 {
		t.Fatalf("accepted decisions=%d, want 1", accepted)
	}
}

func TestDelegatedApprovalStore_MarkPendingUnavailableUsesJSONPayload(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store := openDelegatedApprovalTestStore(t)
	if err := store.UpsertDelegatedApprovalRequest(ctx, delegatedApprovalTestRecord("dappr_unavailable")); err != nil {
		t.Fatalf("Upsert pending: %v", err)
	}
	if _, err := store.SubmitDelegatedApprovalDecisionCAS(ctx, DelegatedApprovalDecisionRequest{
		EndpointID:       "env_delegated",
		ParentThreadID:   "thread_parent",
		ActionID:         "dappr_unavailable",
		Version:          1,
		SurfaceEpoch:     1,
		Approved:         true,
		NextVersion:      2,
		NextActionJSON:   `{"action_id":"dappr_unavailable","state":"approved"}`,
		ResolvedAtUnixMs: 200,
	}); err != nil {
		t.Fatalf("Submit decision: %v", err)
	}
	if err := store.UpsertDelegatedApprovalRequest(ctx, delegatedApprovalTestRecord("dappr_pending_restart")); err != nil {
		t.Fatalf("Upsert pending restart: %v", err)
	}

	count, err := store.MarkPendingDelegatedApprovalsUnavailable(ctx, "restart", 300)
	if err != nil {
		t.Fatalf("MarkPendingDelegatedApprovalsUnavailable: %v", err)
	}
	if count != 2 {
		t.Fatalf("unavailable count=%d, want 2", count)
	}
	got, ok, err := store.GetDelegatedApprovalRequest(ctx, "env_delegated", "thread_parent", "dappr_pending_restart")
	if err != nil {
		t.Fatalf("Get unavailable: %v", err)
	}
	if !ok || got.State != "unavailable" || got.Status != "unavailable" || got.DeliveryState != "delivery_unavailable" {
		t.Fatalf("unavailable record=%#v", got)
	}
	decided, ok, err := store.GetDelegatedApprovalRequest(ctx, "env_delegated", "thread_parent", "dappr_unavailable")
	if err != nil {
		t.Fatalf("Get decided unavailable: %v", err)
	}
	if !ok || decided.State != "unavailable" || decided.Status != "unavailable" || decided.DeliveryState != "delivery_unavailable" || decided.Version != 3 {
		t.Fatalf("decided unavailable record=%#v", decided)
	}
	var outboxDelivery string
	if err := store.db.QueryRowContext(ctx, `
SELECT delivery_state
FROM ai_delegated_approval_outbox
WHERE action_id = ?
LIMIT 1
`, "dappr_unavailable").Scan(&outboxDelivery); err != nil {
		t.Fatalf("query unavailable outbox: %v", err)
	}
	if outboxDelivery != "delivery_unavailable" {
		t.Fatalf("outbox delivery_state=%q, want delivery_unavailable", outboxDelivery)
	}
	var actionPayload map[string]any
	if err := json.Unmarshal([]byte(decided.ActionJSON), &actionPayload); err != nil {
		t.Fatalf("decided action_json is not JSON: %q err=%v", decided.ActionJSON, err)
	}
	if actionPayload["state"] != "unavailable" || actionPayload["status"] != "unavailable" || actionPayload["delivery_state"] != "delivery_unavailable" || actionPayload["can_approve"] != false {
		t.Fatalf("decided action_json=%#v, want unavailable action", actionPayload)
	}
	var payload string
	if err := store.db.QueryRowContext(ctx, `
SELECT payload_json
FROM ai_delegated_approval_events
WHERE action_id = ? AND event_type = 'unavailable'
ORDER BY id DESC
LIMIT 1
`, "dappr_pending_restart").Scan(&payload); err != nil {
		t.Fatalf("query unavailable payload: %v", err)
	}
	var decoded map[string]string
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		t.Fatalf("payload is not JSON: %q err=%v", payload, err)
	}
	if decoded["reason"] != "restart" {
		t.Fatalf("payload reason=%q, want restart", decoded["reason"])
	}
}
