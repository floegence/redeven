package ai

import "testing"

func TestFlowerLiveEncodingAllocationBudget(t *testing.T) {
	current := flowerLiveEncodingBenchmarkCurrent(20)
	for _, item := range publicFloretThreadView(current).Items[:20] {
		if item.Activity == nil || item.Activity.ItemID != item.ID || item.Activity.Presentation == nil || item.Activity.Presentation.Payload == nil {
			t.Fatal("encoding fixture lost its completed public activity")
		}
	}
	envelope := FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion,
		Kind: FlowerLiveStreamThreadBatch, ThreadID: current.ThreadID.String(), Current: &current}
	allocations := testing.AllocsPerRun(5, func() {
		if batch := newFlowerLiveEncodedBatch(envelope); batch.err != nil {
			t.Fatal(batch.err)
		}
	})
	// One public projection plus wire encoding must not repeat the
	// per-activity sanitizer and full current JSON decoding for comparison.
	if allocations > 7000 {
		t.Fatalf("live batch allocations = %.0f; budget 7000 for 20 completed activities", allocations)
	}
}
