package ai

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/redeven/internal/config"
)

type countingListThreadRuntime struct {
	flruntime.ThreadService
	lists         atomic.Int64
	rootLists     atomic.Int64
	summaries     atomic.Int64
	views         atomic.Int64
	summaryErrors map[identity.ThreadID]error
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
	if scope.ParentID == nil {
		runtime.rootLists.Add(1)
	}
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
	if got := counter.lists.Load(); got != 0 {
		t.Fatalf("List calls = %d, want no full canonical inventory scan", got)
	}
	if got := counter.summaries.Load(); got != int64(len(wantIDs)) {
		t.Fatalf("Summary calls = %d, want one per visible thread (%d)", got, len(wantIDs))
	}
	if got := counter.views.Load(); got != 0 {
		t.Fatalf("View calls = %d, want 0", got)
	}
}

func (runtime *countingListThreadRuntime) Summary(ctx context.Context, threadID identity.ThreadID) (flruntime.ThreadSummary, error) {
	runtime.summaries.Add(1)
	if err := runtime.summaryErrors[threadID]; err != nil {
		return flruntime.ThreadSummary{}, err
	}
	return runtime.ThreadService.(flruntime.ThreadSummaryReader).Summary(ctx, threadID)
}

func TestListThreadsIsolatesCorruptCanonicalThread(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	var createdIDs []string
	for _, title := range []string{"first healthy thread", "damaged thread", "last healthy thread"} {
		created, err := svc.CreateThread(t.Context(), meta, title, "", "", "")
		if err != nil {
			t.Fatal(err)
		}
		createdIDs = append(createdIDs, created.ThreadID)
	}
	damagedID := identity.ThreadID(createdIDs[1])
	counter := &countingListThreadRuntime{
		ThreadService: svc.threadRuntime,
		summaryErrors: map[identity.ThreadID]error{
			damagedID: errors.Join(flruntime.ErrAuthorityCorrupt, errors.New("synthetic damaged history")),
		},
	}
	svc.threadRuntime = counter

	page, err := svc.ListThreads(t.Context(), meta, 25, "")
	if err != nil {
		t.Fatalf("one damaged canonical thread failed the full page: %v", err)
	}
	if len(page.Threads) != len(createdIDs) {
		t.Fatalf("listed %d threads, want all %d product-visible threads", len(page.Threads), len(createdIDs))
	}
	seen := make(map[string]ThreadView, len(page.Threads))
	for _, thread := range page.Threads {
		seen[thread.ThreadID] = thread
	}
	if got := seen[damagedID.String()].RunStatus; got != "read_only" {
		t.Fatalf("damaged thread status = %q, want read_only", got)
	}
	for _, id := range createdIDs {
		if id == damagedID.String() {
			continue
		}
		if got := seen[id].RunStatus; got == "read_only" || got == "" {
			t.Fatalf("healthy thread %q status = %q", id, got)
		}
	}
}

func TestPointThreadReadsUsePublishedSummaryReader(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	created, err := svc.CreateThread(t.Context(), meta, "point summary", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	counter := &countingListThreadRuntime{ThreadService: svc.threadRuntime}
	svc.threadRuntime = counter
	if _, err := svc.GetThread(t.Context(), meta, created.ThreadID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.GetFlowerThreadDetail(t.Context(), meta, created.ThreadID); err != nil {
		t.Fatal(err)
	}
	viewsBeforePublication := counter.views.Load()
	if err := svc.publishCanonicalThreadSummary(t.Context(), meta.EndpointID, created.ThreadID); err != nil {
		t.Fatal(err)
	}
	if got := counter.rootLists.Load(); got != 0 {
		t.Fatalf("point reads enumerated root histories %d times", got)
	}
	if got := counter.summaries.Load(); got != 3 {
		t.Fatalf("Summary calls = %d, want 3", got)
	}
	if got := counter.views.Load(); got != viewsBeforePublication {
		t.Fatalf("summary publication loaded %d full views; use one authoritative summary instead of combining independent lifecycle reads", got-viewsBeforePublication)
	}
}

type summaryUnavailableRuntime struct{ flruntime.ThreadService }
type failingSummaryRuntime struct {
	flruntime.ThreadService
	err error
}

func (runtime failingSummaryRuntime) Summary(context.Context, identity.ThreadID) (flruntime.ThreadSummary, error) {
	return flruntime.ThreadSummary{}, runtime.err
}

func TestPointSummaryRequiresPublishedCapabilityAndPreservesErrors(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	created, err := svc.CreateThread(t.Context(), meta, "summary errors", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	id := identity.ThreadID(created.ThreadID)
	if _, err := threadSummaryFromRuntime(t.Context(), summaryUnavailableRuntime{svc.threadRuntime}, id); err == nil {
		t.Fatal("missing Summary capability was accepted")
	}
	for _, want := range []error{context.Canceled, context.DeadlineExceeded, flruntime.ErrThreadNotFound} {
		if _, got := threadSummaryFromRuntime(t.Context(), failingSummaryRuntime{svc.threadRuntime, want}, id); !errors.Is(got, want) {
			t.Fatalf("error = %v, want %v", got, want)
		}
	}
}
