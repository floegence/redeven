package ai

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/floegence/floret/v3/identity"
	flruntime "github.com/floegence/floret/v3/runtime"
)

func TestGetThreadAndListThreadsUseCanonicalFloretStatus(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_canonical_status")
	thread, err := svc.CreateThread(ctx, meta, "canonical status", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host := newTestFloretHostFromService(t, svc, thread.ThreadID, "complete")
	if _, err := host.Run(ctx, flruntime.StartTurnCommand{LogicalRequestID: identity.LogicalRequestID("turn_status"), UserMessage: flruntime.TurnInput{Text: "work"}}); err != nil {
		t.Fatal(err)
	}
	view, err := svc.GetThread(ctx, meta, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if view.RunStatus != string(RunStateSuccess) || view.ActiveRunID != "" || view.LastMessagePreview == "" {
		t.Fatalf("unexpected canonical thread view: %#v", view)
	}
	var singleThreadReads atomic.Int32
	svc.floretReads.thread = func(context.Context, identity.ThreadID) (floretThreadReadHost, error) {
		singleThreadReads.Add(1)
		return nil, errors.New("single-thread read must not serve the thread list")
	}
	list, err := svc.ListThreads(ctx, meta, 20, "")
	if err != nil {
		t.Fatal(err)
	}
	if got := singleThreadReads.Load(); got != 0 {
		t.Fatalf("single-thread reads = %d, want 0", got)
	}
	if len(list.Threads) != 1 || list.Threads[0].RunStatus != string(RunStateSuccess) || list.Threads[0].LastMessagePreview != view.LastMessagePreview {
		t.Fatalf("list did not use canonical state: %#v", list.Threads)
	}
}

func TestInterruptedCanonicalThreadIsTerminalEvenWhenRetryable(t *testing.T) {
	threadID := "thread-interrupted-terminal"
	snapshot := flruntime.ThreadSnapshot{
		ID:          identity.ThreadID(threadID),
		Status:      flruntime.ThreadStatusInterrupted,
		Recoverable: true,
	}
	if canonicalThreadBusy(snapshot) {
		t.Fatal("a retryable interrupted thread was treated as an active execution")
	}
	status, code, message, err := threadViewRunState(snapshot, &flruntime.ThreadTurnSnapshot{
		TurnID: identity.TurnID("turn-interrupted-terminal"),
		Status: flruntime.TurnStatusInterrupted,
		Failure: &flruntime.ThreadTurnFailure{
			Code:    flruntime.ThreadTurnFailureInterrupted,
			Message: "the previous execution was interrupted",
		},
	})
	if err != nil {
		t.Fatalf("threadViewRunState: %v", err)
	}
	if status != string(RunStateFailed) || code != "floret_turn_interrupted" || message == "" {
		t.Fatalf("interrupted terminal view=(%q,%q,%q), want failed with an actionable interruption error", status, code, message)
	}
}

func TestGetThreadReturnsConsistencyErrorWhenFloretThreadIsMissing(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, nil)
	meta := timelineTestMeta("env_missing_canonical")
	thread, err := svc.CreateThread(ctx, meta, "missing", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	host, err := svc.openFloretMaintenanceHost(ctx, thread.ThreadID)
	if err != nil {
		t.Fatal(err)
	}
	if err := host.Delete(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.GetThread(ctx, meta, thread.ThreadID); err == nil {
		t.Fatal("missing canonical Floret thread was treated as idle")
	}
}

func TestCanonicalThreadListInventoryPaginatesUntilAllProductRootsFound(t *testing.T) {
	inventory := &scriptedFloretRootInventory{pages: []floretRootThreadsPage{
		{
			Threads:    []flruntime.ThreadSnapshot{{ID: identity.ThreadID("unrelated")}},
			NextCursor: "page-2",
			HasMore:    true,
		},
		{
			Threads: []flruntime.ThreadSnapshot{
				{ID: identity.ThreadID("thread-b")},
				{ID: identity.ThreadID("thread-a")},
			},
			NextCursor: "must-not-be-read",
			HasMore:    true,
		},
	}}
	svc := &Service{floretReads: &floretReadCapabilities{inventory: inventory}}

	canonical, latest, err := svc.readCanonicalThreadListStates(context.Background(), []string{"thread-a", "thread-b"})
	if err != nil {
		t.Fatal(err)
	}
	if len(canonical) != 2 || canonical["thread-a"].ID != identity.ThreadID("thread-a") || canonical["thread-b"].ID != identity.ThreadID("thread-b") {
		t.Fatalf("canonical inventory = %#v", canonical)
	}
	if len(latest) != 0 {
		t.Fatalf("latest turns = %#v, want empty", latest)
	}
	if len(inventory.requests) != 2 || inventory.requests[0].Cursor != "" || inventory.requests[1].Cursor != "page-2" || inventory.requests[0].Limit != 200 || inventory.requests[1].Limit != 200 {
		t.Fatalf("inventory requests = %#v", inventory.requests)
	}
}

func TestCanonicalThreadListInventoryRejectsMissingProductRoot(t *testing.T) {
	inventory := &scriptedFloretRootInventory{pages: []floretRootThreadsPage{{
		Threads: []flruntime.ThreadSnapshot{{ID: identity.ThreadID("thread-a")}},
	}}}
	svc := &Service{floretReads: &floretReadCapabilities{inventory: inventory}}

	_, _, err := svc.readCanonicalThreadListStates(context.Background(), []string{"thread-a", "thread-missing"})
	if err == nil || !strings.Contains(err.Error(), `missing canonical Floret root "thread-missing"`) {
		t.Fatalf("error = %v, want missing canonical root", err)
	}
}
