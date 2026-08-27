package ai

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/floegence/floret/v5/identity"
	flruntime "github.com/floegence/floret/v5/runtime"
	"github.com/floegence/redeven/internal/config"
)

type countingListThreadRuntime struct {
	flruntime.ThreadService
	lists atomic.Int64
	views atomic.Int64
}

func TestThreadReadsDoNotRequireDesktopModelSourceAvailability(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	created, err := svc.CreateThread(t.Context(), meta, "persistent Flower history", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	desktopModelID := desktopModelSourceModelIDPrefix + "persisted-model"
	reasoningJSON, err := marshalReasoningSelection(config.AIReasoningSelection{Level: config.AIReasoningLevelHigh})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.threadsDB.UpdateThreadModelAndReasoningSelection(
		t.Context(),
		meta.EndpointID,
		created.ThreadID,
		desktopModelID,
		reasoningJSON,
	); err != nil {
		t.Fatal(err)
	}
	svc.desktopModelSource.Disconnect()

	page, err := svc.ListThreads(t.Context(), meta, 25, "")
	if err != nil {
		t.Fatalf("ListThreads with disconnected model source: %v", err)
	}
	if len(page.Threads) != 1 || page.Threads[0].ModelID != desktopModelID {
		t.Fatalf("thread list = %#v, want persisted model %q", page.Threads, desktopModelID)
	}
	if page.Threads[0].ReasoningSelection.Level != config.AIReasoningLevelHigh || !page.Threads[0].ReasoningCapability.IsZero() {
		t.Fatalf("thread list reasoning = (%#v, %#v), want persisted selection and no live capability", page.Threads[0].ReasoningSelection, page.Threads[0].ReasoningCapability)
	}

	thread, err := svc.GetThread(t.Context(), meta, created.ThreadID)
	if err != nil {
		t.Fatalf("GetThread with disconnected model source: %v", err)
	}
	if thread == nil || thread.ModelID != desktopModelID || thread.ReasoningSelection.Level != config.AIReasoningLevelHigh {
		t.Fatalf("thread detail = %#v, want persisted settings", thread)
	}
	flowerDetail, err := svc.GetFlowerThreadDetail(t.Context(), meta, created.ThreadID)
	if err != nil {
		t.Fatalf("GetFlowerThreadDetail with disconnected model source: %v", err)
	}
	if flowerDetail == nil || flowerDetail.Thread.ModelID != desktopModelID {
		t.Fatalf("Flower detail = %#v, want persisted model", flowerDetail)
	}

	if _, err := svc.CreateThread(t.Context(), meta, "must fail", desktopModelSourceModelIDPrefix+"new-model", "", ""); err == nil {
		t.Fatal("thread creation succeeded without a live Desktop model source")
	}
	if err := svc.SetThreadModel(t.Context(), meta, created.ThreadID, desktopModelSourceModelIDPrefix+"other-model"); err == nil {
		t.Fatal("model mutation succeeded without a live Desktop model source")
	}
	if err := svc.SetThreadReasoningSelection(
		t.Context(),
		meta,
		created.ThreadID,
		config.AIReasoningSelection{Level: config.AIReasoningLevelLow},
	); err == nil {
		t.Fatal("reasoning mutation succeeded without a live Desktop model source")
	}
	if _, err := svc.SendUserTurn(t.Context(), meta, SendUserTurnRequest{
		ClientRequestID: "send_disconnected_model_source",
		ThreadID:        created.ThreadID,
		Input:           RunInput{Text: "must fail closed"},
	}); err == nil {
		t.Fatal("send succeeded without a live Desktop model source")
	}
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
