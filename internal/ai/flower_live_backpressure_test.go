package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/floegence/floret/v7/identity"
	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func flowerBackpressureAppend(thread string, base, version uint64, offset int, text string) *flowerLiveEncodedBatch {
	return newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: thread,
		Update: &flruntime.ThreadUpdate{ThreadID: identity.ThreadID(thread), TurnID: "turn", RunID: "run", BaseVersion: base, ViewVersion: version,
			Facts: flruntime.ThreadRuntimeFacts{Activity: flruntime.ThreadActivityActive},
			Items: []flruntime.ThreadItemChange{{Kind: flruntime.ThreadItemAppended, ItemID: "answer", Append: &flruntime.ThreadTextAppend{OffsetBytes: offset, Text: text}}}},
	})
}

func flowerBackpressureCurrent(version uint64, text string) flruntime.ThreadView {
	return flruntime.ThreadView{ThreadID: "thread", TurnID: "turn", RunID: "run", ViewVersion: version, Activity: flruntime.ThreadActivityActive,
		Items: []flruntime.ThreadItem{{ID: "answer", TurnID: "turn", RunID: "run", Ordinal: 1, Kind: flruntime.ThreadItemAssistant, Text: text, Live: true}}}
}

func flowerBackpressureEnvelope(t *testing.T, sub *FlowerLiveStreamSubscription) FlowerLiveStreamEnvelope {
	t.Helper()
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(nextFlowerLiveStreamFrame(t, sub).Data, &envelope); err != nil {
		t.Fatal(err)
	}
	return envelope
}

func TestFlowerLiveBackpressureInitializationConvergesWithoutProducerQuiet(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	sub.subscriber.initializing = true
	ready := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamReady})
	if !retainFlowerLiveBatchLocked(svc, sub.subscriber, ready) {
		t.Fatal("retain ready")
	}
	sub.subscriber.initial = append(sub.subscriber.initial, ready)
	for version := uint64(1); version <= 2000; version++ {
		enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", version-1, version, int(version-1), "x"))
	}
	reads := 0
	svc.threadRuntime = &authorityContinuityRuntime{view: func(context.Context, identity.ThreadID) (flruntime.ThreadView, error) {
		reads++
		// Acquires the subscriber lock: a View under that lock would deadlock.
		// Publish newer output during every read, without waiting for quiescence.
		enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", uint64(1999+reads), uint64(2000+reads), 1999+reads, "x"))
		return flowerBackpressureCurrent(uint64(1999+reads), strings.Repeat("x", 1999+reads)), nil
	}}
	finalizeFlowerLiveSubscriberInitializationLocked(svc, sub.subscriber)
	if flowerBackpressureEnvelope(t, sub).Kind != FlowerLiveStreamReady || sub.subscriber.initializing {
		t.Fatal("initialization did not finish with ready first")
	}
	for version := uint64(2000); version < 2010; version++ {
		envelope := flowerBackpressureEnvelope(t, sub)
		if envelope.Current == nil || envelope.Current.ViewVersion != version || !flowerTestHasText(*envelope.Current, strings.Repeat("x", int(version))) {
			t.Fatalf("snapshot did not progress to %d", version)
		}
		if len(sub.subscriber.queue) != 1 || !sub.subscriber.queue[0].refresh {
			t.Fatal("newer publication was lost during View")
		}
	}
	if svc.FlowerLiveMetrics().SubscriberQueueOverflows != 0 {
		t.Fatal("continuous initialization output overflowed")
	}
	sub.Close()
	if svc.flowerLiveQueuedBytes != 0 {
		t.Fatal("refresh memory was not released")
	}
}

func TestFlowerLiveBackpressureSnapshotAheadOfPumpSuppressesCoveredDeltas(t *testing.T) {
	for _, spanning := range []bool{false, true} {
		t.Run(fmt.Sprint(spanning), func(t *testing.T) {
			svc, sub := subscribeFlowerFragmentTest(t)
			current := flowerBackpressureCurrent(5, "abcde")
			reads := 0
			svc.threadRuntime = &authorityContinuityRuntime{view: func(context.Context, identity.ThreadID) (flruntime.ThreadView, error) { reads++; return current, nil }}
			enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", 0, 1, 0, "a"))
			// An overlapping version range requires canonical convergence.
			boundary := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread",
				Update: &flruntime.ThreadUpdate{ThreadID: "thread", BaseVersion: 0, ViewVersion: 2}})
			enqueueFlowerFragmentTest(t, svc, sub, boundary)
			if got := flowerBackpressureEnvelope(t, sub); got.Current == nil || got.Current.ViewVersion != 5 {
				t.Fatal("missing authoritative current")
			}
			if sub.subscriber.covered[flowerLiveRoute{"thread", "thread", false}] != 5 || svc.flowerLiveQueuedBytes == 0 {
				t.Fatal("ahead-of-pump watermark is not byte accounted")
			}
			for version := uint64(3); version <= 4; version++ {
				enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", version-1, version, int(version-1), "x"))
			}
			if len(sub.subscriber.queue) != 0 {
				t.Fatal("covered deltas replayed text")
			}
			if spanning {
				current = flowerBackpressureCurrent(6, "abcdef")
				enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", 4, 6, 4, "ef"))
				got := flowerBackpressureEnvelope(t, sub)
				if got.Current == nil || got.Current.ViewVersion != 6 || reads != 2 {
					t.Fatal("spanning delta did not converge")
				}
			} else {
				enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", 4, 5, 4, "e"))
				enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", 5, 6, 5, "f"))
				got := flowerBackpressureEnvelope(t, sub)
				if got.Update == nil || got.Update.BaseVersion != 5 || reads != 1 {
					t.Fatal("exact continuation was not delivered incrementally")
				}
			}
			if len(sub.subscriber.covered) != 0 || svc.flowerLiveQueuedBytes != 0 {
				t.Fatal("retired watermark or batch leaked its budget")
			}
		})
	}
}

func TestFlowerLiveBackpressureSlowConsumerSoakPreservesCanonicalState(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	current := flowerBackpressureCurrent(0, "")
	svc.threadRuntime = &authorityContinuityRuntime{view: func(context.Context, identity.ThreadID) (flruntime.ThreadView, error) { return current, nil }}
	observed := current
	observed.Items = append([]flruntime.ThreadItem(nil), current.Items...)
	peakBytes := 0
	// Slow consumption crosses both the old 16-batch bound and the fragment
	// merge bound; compare every delivered checkpoint with canonical text.
	for version := uint64(1); version <= 20000; version++ {
		chunk := "花🌸"
		offset := len(current.Items[0].Text)
		current.ViewVersion = version
		current.Items[0].Text += chunk
		enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", version-1, version, offset, chunk))
		peakBytes = max(peakBytes, svc.flowerLiveQueuedBytes)
		if len(sub.subscriber.queue) > 1 || svc.flowerLiveQueuedBytes > flowerLiveGlobalQueuedByteLimit {
			t.Fatal("soak exceeded bounded mailbox")
		}
		if version%137 == 0 || version == 20000 {
			envelope := flowerBackpressureEnvelope(t, sub)
			if envelope.Current != nil {
				observed = *envelope.Current
			} else if envelope.Update != nil {
				applyFlowerTestUpdate(t, &observed, *envelope.Update)
			} else {
				t.Fatal("missing runtime state")
			}
			if observed.ViewVersion != version || observed.Items[0].Text != current.Items[0].Text {
				t.Fatalf("text diverged at %d", version)
			}
		}
	}
	metrics := svc.FlowerLiveMetrics()
	if metrics.SubscriberQueueOverflows != 0 || metrics.GlobalQueueOverflows != 0 {
		t.Fatalf("soak overflowed: %+v", metrics)
	}
	t.Logf("20000 updates, slow consumer every 137 updates, peak retained mailbox bytes=%d", peakBytes)
	sub.Close()
	if svc.flowerLiveQueuedBytes != 0 {
		t.Fatal("soak leaked retained bytes")
	}
}

func TestFlowerLiveBackpressureMergesRequestGrowthButNotAttemptBoundaries(t *testing.T) {
	started := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	makeBatch := func(version uint64, attempt string, tokens int64) *flowerLiveEncodedBatch {
		at := started.Add(time.Duration(version) * time.Second)
		return newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread",
			Update: &flruntime.ThreadUpdate{ThreadID: "thread", TurnID: "turn", RunID: "run", BaseVersion: version - 1, ViewVersion: version,
				Facts: flruntime.ThreadRuntimeFacts{Activity: flruntime.ThreadActivityActive, RunProgress: &flruntime.ThreadRunProgress{Phase: flruntime.ThreadRunPhaseStreaming,
					Request: &flruntime.ProviderRequestProgress{LogicalRequestID: "request", AttemptID: attempt, AttemptEpoch: 1, StartedAt: started, FirstOutputAt: &started, LastProgressAt: &at, EstimatedOutputTokens: tokens}}},
				Items: []flruntime.ThreadItemChange{{Kind: flruntime.ThreadItemAppended, ItemID: "answer", Append: &flruntime.ThreadTextAppend{OffsetBytes: int(version - 1), Text: "x"}}}},
		})
	}
	first, second := makeBatch(1, "attempt", 1), makeBatch(2, "attempt", 2)
	merged := mergeFlowerLiveAppendBatches(first, second)
	if merged == nil {
		t.Fatal("growing output counters blocked append coalescing")
	}
	var envelope FlowerLiveStreamEnvelope
	if err := json.Unmarshal(merged.data, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Update == nil || envelope.Update.Items[0].Append.Text != "xx" || envelope.Update.Facts.RunProgress.Request.EstimatedOutputTokens != 2 ||
		!envelope.Update.Facts.RunProgress.Request.LastProgressAt.Equal(started.Add(2*time.Second)) {
		t.Fatal("coalescing lost text or latest progress")
	}
	if mergeFlowerLiveAppendBatches(second, makeBatch(3, "retry", 3)) != nil || mergeFlowerLiveAppendBatches(second, makeBatch(3, "attempt", 1)) != nil {
		t.Fatal("append coalescing hid an attempt boundary or counter regression")
	}
}

func TestFlowerLiveBackpressureConvergesAcrossAdmissionWithoutReplayingOldRun(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	current := flowerBackpressureCurrent(200, "complete answer")
	current.RunProgress = &flruntime.ThreadRunProgress{Phase: flruntime.ThreadRunPhaseStreaming}
	svc.threadRuntime = &authorityContinuityRuntime{view: func(context.Context, identity.ThreadID) (flruntime.ThreadView, error) { return current, nil }}
	enqueueFlowerFragmentTest(t, svc, sub, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread",
		Update: &flruntime.ThreadUpdate{ThreadID: "thread", RunID: "old-run", BaseVersion: 0, ViewVersion: 1},
	}))
	for version := uint64(2); version < 200; version++ {
		enqueueFlowerFragmentTest(t, svc, sub, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
			SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread",
			Update: &flruntime.ThreadUpdate{ThreadID: "thread", TurnID: "turn", RunID: "run", BaseVersion: version - 1, ViewVersion: version,
				Facts: flruntime.ThreadRuntimeFacts{Activity: flruntime.ThreadActivityActive, RunProgress: &flruntime.ThreadRunProgress{Phase: flruntime.ThreadRunPhasePreparing}}},
		}))
	}
	enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", 199, 200, 0, "complete answer"))
	if len(sub.subscriber.queue) != 1 || !sub.subscriber.queue[0].refresh {
		t.Fatal("admission and repeated preparing must converge in one mailbox")
	}
	final := flowerBackpressureEnvelope(t, sub)
	if final.Current == nil || final.Current.RunID != "run" || final.Current.ViewVersion != 200 || !flowerTestHasText(*final.Current, "complete answer") ||
		svc.FlowerLiveMetrics().SubscriberQueueOverflows != 0 || svc.flowerLiveQueuedBytes != 0 {
		t.Fatal("repeated preparing did not converge within the queue budget")
	}
}

func TestFlowerLiveBackpressurePreservesSemanticSnapshotsAndSiblingRoutes(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	current := flowerBackpressureCurrent(3, "complete answer")
	current.Items = append(current.Items, flruntime.ThreadItem{ID: "tool", TurnID: "turn", RunID: "run", Kind: flruntime.ThreadItemTool, Ordinal: 2,
		Activity: &observation.ActivityItem{ItemID: "tool", ToolID: "tool", ToolName: "inspect", Kind: observation.ActivityKindTool, Status: observation.ActivityStatusSuccess}})
	current.Attention = flruntime.AttentionSummary{ApprovalCount: 1, InputCount: 1}
	current.Interactions = []flruntime.ThreadInteraction{{ID: "approval", Kind: flruntime.ThreadInteractionApproval, TurnID: "turn", RunID: "run", ToolCallID: "tool"}}
	current.Cancellation = &flruntime.ThreadCancellation{ThreadID: "thread", TurnID: "turn", RunID: "run", Source: "user", Mode: flruntime.CancelModeGraceful, RequestedAt: time.Now()}
	svc.threadRuntime = &authorityContinuityRuntime{view: func(_ context.Context, id identity.ThreadID) (flruntime.ThreadView, error) {
		result := current
		result.ThreadID = id
		return result, nil
	}}
	sub.subscriber.initializing = true
	for _, id := range []string{"child1", "child2"} {
		for version := uint64(1); version <= 3; version++ {
			enqueueFlowerFragmentTest(t, svc, sub, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
				SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "parent",
				SubagentUpdate: &flruntime.ThreadUpdate{ThreadID: identity.ThreadID(id), BaseVersion: version - 1, ViewVersion: version},
			}))
		}
	}
	finalizeFlowerLiveSubscriberInitializationLocked(svc, sub.subscriber)
	for _, id := range []string{"child1", "child2"} {
		got := flowerBackpressureEnvelope(t, sub)
		if got.ThreadID != "parent" || got.SubagentCurrent == nil || got.SubagentCurrent.ThreadID.String() != id ||
			got.SubagentCurrent.Attention.ApprovalCount != 1 || len(got.SubagentCurrent.Interactions) != 1 || len(got.SubagentCurrent.Items) != 2 || got.SubagentCurrent.Cancellation == nil ||
			got.SubagentCurrent.Items[1].Activity == nil || got.SubagentCurrent.Items[1].Activity.Status != observation.ActivityStatusSuccess {
			t.Fatalf("semantic state or sibling route lost: %+v", got)
		}
	}
	current.ViewVersion = 5
	current.Activity = flruntime.ThreadActivityIdle
	outcome := flruntime.TurnOutcomeCancelled
	current.LastOutcome = &outcome
	current.Failure = &flruntime.ThreadTurnFailure{Code: flruntime.ThreadTurnFailureEngineContract, Message: "visible failure"}
	enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", 3, 4, 0, "x"))
	enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", 4, 5, 99, "x"))
	var got struct {
		Current *flowerPublicCurrent `json:"current"`
	}
	if err := json.Unmarshal(nextFlowerLiveStreamFrame(t, sub).Data, &got); err != nil {
		t.Fatal(err)
	}
	if got.Current == nil || got.Current.LastOutcome == nil || *got.Current.LastOutcome != outcome || got.Current.Error == "" || got.Current.Items[0].Text != "complete answer" {
		t.Fatal("terminal facts or canonical text lost")
	}
}

func TestFlowerLiveBackpressureAuthorityFailureFencesAndReleasesMemory(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	svc.threadRuntime = &authorityContinuityRuntime{view: func(context.Context, identity.ThreadID) (flruntime.ThreadView, error) {
		return flruntime.ThreadView{}, errors.New("authority unavailable")
	}}
	enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", 0, 1, 0, "a"))
	enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", 1, 2, 100, "b"))
	if frame, err := sub.Next(t.Context()); frame != nil || !errors.Is(err, ErrFlowerLiveSync) || !sub.subscriber.closed || svc.flowerLiveQueuedBytes != 0 {
		t.Fatalf("authority failure did not fence: frame=%v error=%v", frame, err)
	}
}

func TestFlowerLiveBackpressureCoalescesMetadataWithoutCrossingOwners(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	for revision := int64(1); revision <= 100; revision++ {
		for _, thread := range []string{"thread1", "thread2"} {
			subagents := []FlowerSubagentSummary{{ThreadID: fmt.Sprintf("child-%d", revision)}}
			for _, envelope := range []FlowerLiveStreamEnvelope{
				{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamSummaryBatch, Summaries: []ThreadView{{ThreadID: thread, Title: fmt.Sprint(revision)}}},
				{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamViewerReadState, ThreadID: thread, ReadStatus: &FlowerThreadReadView{ReadState: FlowerThreadReadRecord{LastSeenActivityRevision: revision}}},
				{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: thread, Subagents: &subagents},
			} {
				enqueueFlowerFragmentTest(t, svc, sub, newFlowerLiveEncodedBatch(envelope))
			}
		}
	}
	if len(sub.subscriber.queue) != 6 {
		t.Fatalf("metadata retained %d batches, want one per kind and thread", len(sub.subscriber.queue))
	}
	for _, thread := range []string{"thread1", "thread2"} {
		summary, read, children := flowerBackpressureEnvelope(t, sub), flowerBackpressureEnvelope(t, sub), flowerBackpressureEnvelope(t, sub)
		if len(summary.Summaries) != 1 || summary.Summaries[0].ThreadID != thread || summary.Summaries[0].Title != "100" ||
			read.ThreadID != thread || read.ReadStatus == nil || read.ReadStatus.ReadState.LastSeenActivityRevision != 100 ||
			children.ThreadID != thread || children.Subagents == nil || len(*children.Subagents) != 1 || (*children.Subagents)[0].ThreadID != "child-100" {
			t.Fatal("metadata did not retain the latest value for its thread")
		}
	}
	if svc.flowerLiveQueuedBytes != 0 {
		t.Fatal("metadata replacements leaked retained bytes")
	}
}

func TestFlowerLiveBackpressureKeepsDistinctRouteLimit(t *testing.T) {
	for _, initializing := range []bool{false, true} {
		t.Run(fmt.Sprint(initializing), func(t *testing.T) {
			svc, sub := subscribeFlowerFragmentTest(t)
			sub.subscriber.initializing = initializing
			for index := 0; index < flowerLiveSubscriberBatchLimit; index++ {
				enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend(fmt.Sprintf("thread-%d", index), 0, 1, 0, "x"))
			}
			svc.mu.Lock()
			accepted := enqueueFlowerLiveSubscriberLocked(svc, sub.subscriber, flowerBackpressureAppend("overflow", 0, 1, 0, "x"))
			svc.mu.Unlock()
			if accepted || !sub.subscriber.closed || svc.flowerLiveQueuedBytes != 0 || svc.FlowerLiveMetrics().SubscriberQueueOverflows != 1 {
				t.Fatal("distinct routes bypassed the original batch limit")
			}
		})
	}
}
