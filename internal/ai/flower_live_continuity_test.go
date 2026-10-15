package ai

import (
	"bytes"
	"fmt"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestFlowerLiveInterleavedLargeTextGrowthRemainsBounded(t *testing.T) {
	for _, initializing := range []bool{false, true} {
		t.Run(fmt.Sprintf("initializing_%t", initializing), func(t *testing.T) {
			svc, sub := subscribeFlowerFragmentTest(t)
			sub.subscriber.initializing = initializing
			latest := make([]*flowerLiveEncodedBatch, 3)
			for tick := range 40 {
				for index := range latest {
					current := largeFlowerLiveCurrent()
					current.ThreadID = identity.ThreadID(fmt.Sprintf("thread-stream-%d", index))
					current.ViewVersion = uint64(tick + 1)
					current.Items[len(current.Items)-1].Text += string(bytes.Repeat([]byte("."), tick))
					envelope := FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread-parent"}
					if index == 0 {
						envelope.ThreadID = current.ThreadID.String()
						envelope.Current = &current
					} else {
						envelope.SubagentCurrent = &current
					}
					latest[index] = newFlowerLiveEncodedBatch(envelope)
					enqueueFlowerFragmentTest(t, svc, sub, latest[index])
				}
			}
			if initializing {
				svc.mu.Lock()
				finalizeFlowerLiveSubscriberInitializationLocked(svc, sub.subscriber)
				svc.mu.Unlock()
			}
			for _, want := range latest {
				if got := nextFlowerLiveStreamFrame(t, sub); !bytes.Equal(got.Data, want.data) {
					t.Fatal("interleaved text did not converge to the latest complete current")
				}
			}
			if len(sub.subscriber.queue) != 0 || svc.flowerLiveQueuedBytes != 0 || sub.subscriber.closed {
				t.Fatal("pure text workload retained stale work or closed the stream")
			}
		})
	}
}

func TestFlowerLiveInterleavedCoalescingPreservesOrderingBarriers(t *testing.T) {
	for _, boundary := range []string{"context", "inventory", "summary", "terminal", "new_item", "route"} {
		t.Run(boundary, func(t *testing.T) {
			svc, sub := subscribeFlowerFragmentTest(t)
			current := largeFlowerLiveCurrent()
			current.Items = current.Items[len(current.Items)-1:]
			first := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: current.ThreadID.String(), Current: &current})
			other := current
			other.ThreadID = "thread-independent"
			independent := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: other.ThreadID.String(), Current: &other})
			barrierCurrent := current
			barrierCurrent.ViewVersion = 2
			barrier := FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: current.ThreadID.String()}
			switch boundary {
			case "context":
				barrier.ContextUsage = &FlowerContextUsage{}
			case "inventory":
				barrier.Subagents = &[]FlowerSubagentSummary{}
			case "summary":
				barrier.Kind = FlowerLiveStreamSummaryBatch
				barrier.Summaries = []ThreadView{{ThreadID: current.ThreadID.String()}}
			case "terminal":
				barrierCurrent.Activity = flruntime.ThreadActivityIdle
				barrier.Current = &barrierCurrent
			case "new_item":
				item := current.Items[0]
				item.ID, item.Ordinal = "new-item", 396
				barrierCurrent.Items = append(append([]flruntime.ThreadItem(nil), current.Items...), item)
				barrier.Current = &barrierCurrent
			case "route":
				barrier.ThreadID = "thread-other-parent"
				barrier.SubagentCurrent = &barrierCurrent
			}
			boundaryBatch := newFlowerLiveEncodedBatch(barrier)
			current.ViewVersion = 3
			current.Items[0].Text += " more"
			last := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: current.ThreadID.String(), Current: &current})
			want := []*flowerLiveEncodedBatch{first, independent, boundaryBatch, last}
			for _, batch := range want {
				enqueueFlowerFragmentTest(t, svc, sub, batch)
			}
			for _, batch := range want {
				if got := nextFlowerLiveStreamFrame(t, sub); !bytes.Equal(got.Data, batch.data) {
					t.Fatal("coalescing crossed an auxiliary, route or semantic boundary")
				}
			}
		})
	}
}

func TestFlowerLiveLargeBaselineAcceptsConcurrentLiveWork(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	svc.mu.Lock()
	sub.subscriber.initializing = true
	var baseline []*flowerLiveEncodedBatch
	for index := range 24 {
		batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: fmt.Sprintf("thread-baseline-%d", index)})
		if !retainFlowerLiveBatchLocked(svc, sub.subscriber, batch) {
			t.Fatal("baseline retention failed")
		}
		baseline = append(baseline, batch)
		sub.subscriber.initial = append(sub.subscriber.initial, batch)
	}
	finalizeFlowerLiveSubscriberInitializationLocked(svc, sub.subscriber)
	svc.mu.Unlock()
	current := largeFlowerLiveCurrent()
	var latest *flowerLiveEncodedBatch
	for version := range 30 {
		current.ViewVersion = uint64(version + 1)
		current.Items[len(current.Items)-1].Text += "."
		latest = newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, Current: &current})
		enqueueFlowerFragmentTest(t, svc, sub, latest)
	}
	for _, want := range append(baseline, latest) {
		if got := nextFlowerLiveStreamFrame(t, sub); !bytes.Equal(got.Data, want.data) {
			t.Fatal("baseline or concurrent live current changed order")
		}
	}
	if svc.flowerLiveQueuedBytes != 0 {
		t.Fatal("baseline and concurrent live work leaked retained bytes")
	}
}
