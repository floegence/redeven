package ai

import (
	"context"
	"errors"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestFlowerLiveBaselineFreezesMembershipAndQueuesConcurrentChanges(t *testing.T) {
	// Drive this queue explicitly; startup facts are a separate asynchronous owner.
	svc := newSendTurnTestServiceWithActivation(t, true)
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
	if got := counter.summaries.Load(); got != 0 {
		t.Fatalf("handshake read %d summaries before ready", got)
	}
	// Consuming a prefix releases string contents, but the backing array stays
	// live until the complete inventory has drained. Keep its capacity budgeted.
	initialBytes := 0
	for _, batch := range sub.subscriber.initial {
		initialBytes += batch.bytes()
	}
	remainingIDBytes := 0
	for _, id := range ids {
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
	svc.broadcastFlowerRuntimeUpdate(meta.EndpointID, "", flruntime.ThreadUpdate{ThreadID: identity.ThreadID(ids[0]), BaseVersion: 1, ViewVersion: 2, Facts: flruntime.ThreadRuntimeFacts{Activity: flruntime.ThreadActivityIdle}})
	svc.publishFlowerLiveSummary(meta.EndpointID, ThreadView{ThreadID: "concurrent-root", Title: "concurrent"})
	seen := map[string]bool{}
	for _, summary := range first.Summaries {
		seen[summary.ThreadID] = true
	}
	complete := false
	factsSeen := false
	for {
		envelope := flowerBackpressureEnvelope(t, sub)
		if envelope.Kind == FlowerLiveStreamViewerReadState {
			continue
		}
		if envelope.BaselineComplete == nil {
			// Creation facts may still be in the runtime pump. Both facts and
			// summary changes must follow the complete sidebar baseline.
			if envelope.FactsOnly {
				if !complete {
					t.Fatal("runtime facts overtook baseline")
				}
				factsSeen = true
				continue
			}
			if !complete || len(envelope.Summaries) != 1 || envelope.Summaries[0].ThreadID != "concurrent-root" {
				t.Fatalf("live change overtook baseline: complete=%v envelope=%+v", complete, envelope)
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
	if !factsSeen {
		t.Fatal("concurrent facts were lost")
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
	if err := <-done; !errors.Is(err, io.EOF) {
		t.Fatalf("page cancellation=%v", err)
	}
	if svc.flowerLiveQueuedBytes != 0 || sub.subscriber.baselineThreadIDs != nil {
		t.Fatal("cancelled observer retained baseline")
	}
}

func TestFlowerLiveReadingUpdatesBypassSlowSidebarPage(t *testing.T) {
	svc := newSendTurnTestService(t)
	meta := testSendTurnMeta()
	thread, err := svc.CreateThread(t.Context(), meta, "slow sidebar", "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	runtime := &cancellingBaselineRuntime{ThreadService: svc.threadRuntime, entered: make(chan struct{})}
	svc.threadRuntime = runtime
	sub, err := svc.SubscribeFlowerLiveStream(t.Context(), meta, FlowerLiveStreamRequest{})
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	if frame := nextFlowerLiveStreamFrame(t, sub); frame.Kind != FlowerLiveStreamReady {
		t.Fatal("handshake missing")
	}
	done := make(chan *FlowerLiveStreamFrame, 1)
	go func() {
		frame, err := sub.Next(t.Context())
		if err != nil {
			t.Errorf("stream read: %v", err)
		}
		done <- frame
	}()
	<-runtime.entered
	svc.mu.Lock()
	enqueueFlowerLiveSubscriberLocked(svc, sub.subscriber, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: thread.ThreadID, ReadingRevision: 1, Update: &flruntime.ThreadUpdate{ThreadID: identity.ThreadID(thread.ThreadID), BaseVersion: 1, ViewVersion: 2, Facts: flruntime.ThreadRuntimeFacts{Activity: flruntime.ThreadActivityIdle}}}))
	svc.mu.Unlock()
	select {
	case frame := <-done:
		if frame == nil || frame.Kind != FlowerLiveStreamThreadBatch {
			t.Fatalf("reading update blocked: %+v", frame)
		}
	case <-time.After(time.Second):
		t.Fatal("reading update waited for sidebar")
	}
}
