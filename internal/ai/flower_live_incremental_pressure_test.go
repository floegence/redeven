package ai

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/floegence/floret/v7/identity"
	flruntime "github.com/floegence/floret/v7/runtime"
)

func TestFlowerLiveMixedBacklogDoesNotHydrateHistory(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	svc.threadRuntime = &authorityContinuityRuntime{view: func(context.Context, identity.ThreadID) (flruntime.ThreadView, error) {
		t.Fatal("bounded mixed backlog hydrated historical content")
		return flruntime.ThreadView{}, nil
	}}
	observed := flowerBackpressureCurrent(0, "")
	for index := range 2600 {
		observed.Items = append(observed.Items, flruntime.ThreadItem{ID: fmt.Sprintf("history-%d", index), Text: strings.Repeat("history ", 512)})
	}
	var expected strings.Builder
	for version := uint64(1); version <= 600; version++ {
		if version%2 == 1 {
			chunk := "花🌸增量"
			enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", version-1, version, expected.Len(), chunk))
			expected.WriteString(chunk)
		} else {
			interactions := []flruntime.ThreadInteraction{{ID: "approval", Kind: flruntime.ThreadInteractionApproval, TurnID: "turn", RunID: "run", ToolCallID: "tool"}}
			if version%4 == 0 {
				interactions = nil
			}
			enqueueFlowerFragmentTest(t, svc, sub, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
				SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread",
				Update: &flruntime.ThreadUpdate{ThreadID: "thread", TurnID: "turn", RunID: "run", BaseVersion: version - 1, ViewVersion: version,
					Facts:        flruntime.ThreadRuntimeFacts{Activity: flruntime.ThreadActivityActive},
					Interactions: &flruntime.ThreadComponent[[]flruntime.ThreadInteraction]{Value: interactions}},
			}))
		}
		if version%12 != 0 {
			continue
		}
		for len(sub.subscriber.queue) > 0 {
			envelope := flowerBackpressureEnvelope(t, sub)
			if envelope.Update == nil || envelope.Current != nil {
				t.Fatal("mixed backlog did not preserve incremental updates")
			}
			applyFlowerTestUpdate(t, &observed, *envelope.Update)
			if observed.ViewVersion%2 == 0 && len(observed.Interactions) != int(observed.ViewVersion%4/2) {
				t.Fatal("pending approval boundary was omitted")
			}
		}
		if observed.ViewVersion != version || observed.Items[0].Text != expected.String() || len(observed.Items) != 2601 || svc.flowerLiveQueuedBytes != 0 {
			t.Fatal("ordered delivery lost content, history, or retained bytes")
		}
	}
}

func TestFlowerLiveFragmentBoundaryDoesNotReadCurrent(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	svc.threadRuntime = &authorityContinuityRuntime{view: func(context.Context, identity.ThreadID) (flruntime.ThreadView, error) {
		t.Fatal("fragment boundary requested complete history")
		return flruntime.ThreadView{}, nil
	}}
	observed := flowerBackpressureCurrent(0, "")
	chunk := strings.Repeat("花🌸", 3000)
	for version := uint64(1); version <= 3; version++ {
		enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", version-1, version, int(version-1)*len(chunk), chunk))
	}
	for range 3 {
		envelope := flowerBackpressureEnvelope(t, sub)
		if envelope.Update == nil {
			t.Fatal("expected an intact append chunk")
		}
		applyFlowerTestUpdate(t, &observed, *envelope.Update)
	}
	if observed.Items[0].Text != strings.Repeat(chunk, 3) || svc.flowerLiveQueuedBytes != 0 {
		t.Fatal("large Unicode output was truncated or retained")
	}
}

func TestFlowerLiveCapacityRecoveryRetiresOnlyCoveredRoute(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	reads := 0
	svc.threadRuntime = &authorityContinuityRuntime{view: func(context.Context, identity.ThreadID) (flruntime.ThreadView, error) {
		reads++
		return flowerBackpressureCurrent(16, "complete"), nil
	}}
	for version := uint64(1); version <= 16; version++ {
		enqueueFlowerFragmentTest(t, svc, sub, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
			SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread",
			Update: &flruntime.ThreadUpdate{ThreadID: "thread", BaseVersion: version - 1, ViewVersion: version},
		}))
		if version == 1 {
			enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("sibling", 0, 1, 0, "sibling"))
		}
	}
	if len(sub.subscriber.queue) != 2 || !sub.subscriber.queue[0].refresh || sub.subscriber.queue[1].route.threadID != "sibling" {
		t.Fatal("capacity recovery retained covered deltas or changed sibling order")
	}
	current, sibling := flowerBackpressureEnvelope(t, sub), flowerBackpressureEnvelope(t, sub)
	if reads != 1 || current.Current == nil || current.Current.ViewVersion != 16 || sibling.Update == nil || sibling.Update.ThreadID != "sibling" || svc.flowerLiveQueuedBytes != 0 {
		t.Fatal("capacity recovery lost canonical or sibling state")
	}
}

func TestFlowerLiveCurrentRetiresCoveredDeltasWithoutReorderingMetadata(t *testing.T) {
	svc, sub := subscribeFlowerFragmentTest(t)
	for version := uint64(1); version <= 3; version++ {
		enqueueFlowerFragmentTest(t, svc, sub, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
			SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread",
			Update: &flruntime.ThreadUpdate{ThreadID: "thread", BaseVersion: version - 1, ViewVersion: version},
		}))
		if version == 1 {
			enqueueFlowerFragmentTest(t, svc, sub, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
				SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamSummaryBatch,
				Summaries: []ThreadView{{ThreadID: "sibling", Title: "Keep metadata"}},
			}))
		}
	}
	current := flowerBackpressureCurrent(4, "complete")
	enqueueFlowerFragmentTest(t, svc, sub, newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{
		SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: "thread", Current: &current,
	}))
	enqueueFlowerFragmentTest(t, svc, sub, flowerBackpressureAppend("thread", 4, 5, len("complete"), "!"))
	if len(sub.subscriber.queue) != 3 {
		t.Fatal("current replacement did not retire all covered deltas")
	}
	first, metadata, next := flowerBackpressureEnvelope(t, sub), flowerBackpressureEnvelope(t, sub), flowerBackpressureEnvelope(t, sub)
	if first.Current == nil || first.Current.ViewVersion != 4 || metadata.Kind != FlowerLiveStreamSummaryBatch ||
		next.Update == nil || next.Update.BaseVersion != 4 || svc.flowerLiveQueuedBytes != 0 {
		t.Fatal("current supersession lost metadata or its exact incremental continuation")
	}
}
