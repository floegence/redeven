package ai

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestFlowerLiveBaselineFreezesMembershipAndQueuesConcurrentChanges(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	for i := range flowerLiveBaselinePageLimit + 5 {
		if _, err := svc.CreateThread(t.Context(), meta, fmt.Sprintf("baseline %d", i), "", "", ""); err != nil {
			t.Fatal(err)
		}
	}
	ids, err := svc.threadsDB.ListRootThreadIDs(t.Context(), meta.EndpointID, flowerLiveEnvelopeByteLimit)
	if err != nil {
		t.Fatal(err)
	}
	counter := &countingListThreadRuntime{ThreadService: svc.threadRuntime}
	svc.threadRuntime = counter
	sub, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	if got := counter.summaries.Load(); got != flowerLiveBaselinePageLimit {
		t.Fatalf("startup read %d summaries before ready", got)
	}
	// Consuming a prefix releases string contents, but the backing array stays
	// live until the complete inventory has drained. Keep its capacity budgeted.
	initialBytes := 0
	for _, batch := range sub.subscriber.initial {
		initialBytes += batch.bytes()
	}
	remainingIDBytes := 0
	for _, id := range ids[flowerLiveBaselinePageLimit:] {
		remainingIDBytes += len(id)
	}
	if retained := sub.subscriber.queuedBytes - initialBytes; retained < remainingIDBytes+16*len(ids) {
		t.Fatalf("inventory retains its backing array but accounts for only %d bytes", retained)
	}
	first := flowerBackpressureEnvelope(t, sub)
	if first.Kind != FlowerLiveStreamReady || first.BaselineComplete == nil || *first.BaselineComplete {
		t.Fatal("missing partial ready")
	}
	// Moving an unseen root ahead of the old cursor must not skip it.
	if _, err := svc.threadsDB.SetThreadPinned(t.Context(), meta.EndpointID, ids[len(ids)-1], true); err != nil {
		t.Fatal(err)
	}
	svc.publishFlowerLiveSummary(meta.EndpointID, ThreadView{ThreadID: "concurrent-root", Title: "concurrent"})
	seen := map[string]bool{}
	for _, summary := range first.Summaries {
		seen[summary.ThreadID] = true
	}
	complete := false
	for {
		envelope := flowerBackpressureEnvelope(t, sub)
		if envelope.Kind == FlowerLiveStreamViewerReadState {
			continue
		}
		if envelope.BaselineComplete == nil {
			if !complete || len(envelope.Summaries) != 1 || envelope.Summaries[0].ThreadID != "concurrent-root" {
				t.Fatal("live change overtook baseline")
			}
			break
		}
		for _, summary := range envelope.Summaries {
			if seen[summary.ThreadID] {
				t.Fatal("duplicate frozen root")
			}
			seen[summary.ThreadID] = true
		}
		complete = *envelope.BaselineComplete
		if complete && sub.subscriber.baselineThreadIDs != nil {
			t.Fatal("completed baseline retains its identity array")
		}
	}
	if len(seen) != len(ids) {
		t.Fatalf("retained %d/%d roots", len(seen), len(ids))
	}
	for _, id := range ids {
		if !seen[id] {
			t.Fatal("pin change skipped root")
		}
	}
	sub.Close()
	if svc.flowerLiveQueuedBytes != 0 || sub.subscriber.baselineThreadIDs != nil {
		t.Fatal("closed observer retained baseline")
	}
}

type cancellingBaselineRuntime struct {
	flruntime.ThreadService
	entered chan struct{}
}

func (runtime *cancellingBaselineRuntime) Summary(ctx context.Context, _ identity.ThreadID) (flruntime.ThreadSummary, error) {
	close(runtime.entered)
	<-ctx.Done()
	return flruntime.ThreadSummary{}, ctx.Err()
}

func TestFlowerLiveBaselineCloseCancelsInFlightPage(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	for i := range flowerLiveBaselinePageLimit + 1 {
		if _, err := svc.CreateThread(t.Context(), meta, fmt.Sprintf("cancel %d", i), "", "", ""); err != nil {
			t.Fatal(err)
		}
	}
	sub, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	for len(sub.subscriber.initial) > 0 {
		_ = nextFlowerLiveStreamFrame(t, sub)
	}
	runtime := &cancellingBaselineRuntime{ThreadService: svc.threadRuntime, entered: make(chan struct{})}
	svc.threadRuntime = runtime
	done := make(chan error, 1)
	go func() { _, err := sub.Next(t.Context()); done <- err }()
	<-runtime.entered
	sub.Close()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("page cancellation=%v", err)
	}
	if svc.flowerLiveQueuedBytes != 0 || sub.subscriber.baselineThreadIDs != nil {
		t.Fatal("cancelled observer retained baseline")
	}
}
