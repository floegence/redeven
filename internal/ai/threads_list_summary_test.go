package ai

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/floegence/floret/v5/identity"
	flruntime "github.com/floegence/floret/v5/runtime"
)

type countingListThreadRuntime struct {
	flruntime.ThreadService
	lists atomic.Int64
	views atomic.Int64
}

func (runtime *countingListThreadRuntime) List(ctx context.Context, scope flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) {
	runtime.lists.Add(1)
	return runtime.ThreadService.List(ctx, scope)
}

func (runtime *countingListThreadRuntime) View(ctx context.Context, threadID identity.ThreadID) (flruntime.ThreadView, error) {
	runtime.views.Add(1)
	return runtime.ThreadService.View(ctx, threadID)
}

func TestListThreadsUsesSummaryWithoutLoadingThreadViews(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	wantIDs := make(map[string]struct{}, 25)
	for index := range 25 {
		created, err := svc.CreateThread(t.Context(), meta, fmt.Sprintf("summary-only list %02d", index), "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		wantIDs[created.ThreadID] = struct{}{}
	}
	counter := &countingListThreadRuntime{ThreadService: svc.threadRuntime}
	svc.threadRuntime = counter

	page, err := svc.ListThreads(t.Context(), meta, 25, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Threads) != len(wantIDs) {
		t.Fatalf("thread list count = %d, want %d", len(page.Threads), len(wantIDs))
	}
	for _, thread := range page.Threads {
		if _, ok := wantIDs[thread.ThreadID]; !ok {
			t.Fatalf("thread list contains unexpected summary %#v", thread)
		}
		if thread.Title == "" {
			t.Fatalf("thread %q has no summary title", thread.ThreadID)
		}
	}
	if got := counter.lists.Load(); got != 1 {
		t.Fatalf("List calls = %d, want 1", got)
	}
	if got := counter.views.Load(); got != 0 {
		t.Fatalf("View calls = %d, want 0", got)
	}
}
