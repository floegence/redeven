package ai

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

// An activity commit immediately after View must not become evidence that its
// new body was included in that earlier view.
type flowerDetailAdvancingRuntime struct {
	flruntime.ThreadService
	current  flruntime.ThreadView
	summary  flruntime.ThreadSummary
	revision int64
}

func (r *flowerDetailAdvancingRuntime) List(context.Context, flruntime.ThreadScope) ([]flruntime.ThreadSummary, error) {
	summary := r.summary
	summary.UpdatedAt = time.UnixMilli(r.revision)
	summary.LastItemAt = summary.UpdatedAt
	return []flruntime.ThreadSummary{summary}, nil
}

func (r *flowerDetailAdvancingRuntime) View(context.Context, identity.ThreadID) (flruntime.ThreadView, error) {
	current := r.current
	current.ViewVersion = uint64(r.revision)
	current.Items = []flruntime.ThreadItem{{ID: "rendered", Kind: flruntime.ThreadItemAssistant, Text: strconv.FormatInt(r.revision, 10)}}
	r.revision += 1000
	return current, nil
}

func TestFlowerDetailReadRevisionNeverExceedsItsBody(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "Read revision", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	id := identity.ThreadID(thread.ThreadID)
	current, err := svc.threadRuntime.View(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	summary, err := threadSummaryFromRuntime(t.Context(), svc.threadRuntime, id)
	if err != nil {
		t.Fatal(err)
	}
	svc.threadRuntime = &flowerDetailAdvancingRuntime{ThreadService: svc.threadRuntime, current: current, summary: summary, revision: 1000}
	for _, revision := range []int64{1000, 2000} {
		detail, err := svc.GetFlowerThreadDetail(t.Context(), meta, thread.ThreadID)
		if err != nil {
			t.Fatal(err)
		}
		if detail.Thread.FlowerActivity.ActivityRevision != revision || detail.Current.ViewVersion != uint64(revision) || detail.Current.Items[0].Text != strconv.FormatInt(revision, 10) {
			t.Fatalf("activity revision=%d body version=%d text=%q; want rendered revision %d", detail.Thread.FlowerActivity.ActivityRevision, detail.Current.ViewVersion, detail.Current.Items[0].Text, revision)
		}
	}
}
