package ai

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/tools"
)

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
	// One public projection plus wire/fingerprint encoding must not repeat the
	// per-activity sanitizer and full current JSON decoding for comparison.
	if allocations > 7000 {
		t.Fatalf("live batch allocations = %.0f; budget 7000 for 20 completed activities", allocations)
	}
}

func TestFlowerLiveComparisonReusesCompletePublicProjection(t *testing.T) {
	for _, child := range []bool{false, true} {
		t.Run(map[bool]string{false: "root", true: "child"}[child], func(t *testing.T) {
			current := flowerLiveEncodingBenchmarkCurrent(2)
			current.Context = &flruntime.ThreadContextSnapshot{}
			at := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
			current.RunProgress = &flruntime.ThreadRunProgress{Phase: flruntime.ThreadRunPhaseStreaming,
				Request: &flruntime.ProviderRequestProgress{LogicalRequestID: "request", AttemptID: "attempt", AttemptEpoch: 1,
					StartedAt: at, FirstOutputAt: &at, LastProgressAt: &at, EstimatedOutputTokens: 12}}
			additions, deletions := 2, 1
			current.ToolCallPreviews = []flruntime.ThreadToolCallPreview{{ThreadID: current.ThreadID, TurnID: current.TurnID, RunID: current.RunID,
				LogicalRequestID: "request", AttemptID: "attempt", AttemptEpoch: 1, CallID: "call", Name: "file.write",
				Preview: &tools.ArgumentPreview{DisplayName: "safe.txt", Additions: &additions, Deletions: &deletions}}}
			envelope := FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: current.ThreadID.String()}
			if child {
				envelope.ThreadID = "thread-parent"
				envelope.SubagentCurrent = &current
			} else {
				envelope.Current = &current
			}
			encoded, err := json.Marshal(envelope)
			if err != nil {
				t.Fatal(err)
			}
			normalized := current
			normalized.ViewVersion = 0
			progress := *current.RunProgress
			request := *progress.Request
			request.EstimatedOutputTokens = 0
			request.LastProgressAt = new(time.Time)
			progress.Request = &request
			normalized.RunProgress = &progress
			normalized.ToolCallPreviews = append([]flruntime.ThreadToolCallPreview(nil), current.ToolCallPreviews...)
			preview := *current.ToolCallPreviews[0].Preview
			preview.Additions = new(int)
			preview.Deletions = new(int)
			normalized.ToolCallPreviews[0].Preview = &preview
			normalized.Items = append([]flruntime.ThreadItem(nil), current.Items...)
			normalized.Items[len(normalized.Items)-1].Text = "\x00"
			actual, err := flowerLiveComparisonJSON(encoded, &current, normalized, child)
			if err != nil {
				t.Fatal(err)
			}
			if child {
				envelope.SubagentCurrent = &normalized
			} else {
				envelope.Current = &normalized
			}
			expected, err := marshalFlowerLiveEnvelopeAt(envelope, time.Time{})
			if err != nil {
				t.Fatal(err)
			}
			decode := func(data []byte) any {
				var value any
				decoder := json.NewDecoder(bytes.NewReader(data))
				decoder.UseNumber()
				if err := decoder.Decode(&value); err != nil {
					t.Fatal(err)
				}
				return value
			}
			if !reflect.DeepEqual(decode(expected), decode(actual)) {
				t.Fatalf("public comparison changed: expected %s, actual %s", expected, actual)
			}
			var preserved map[string]json.RawMessage
			if err := json.Unmarshal(encoded, &preserved); err != nil {
				t.Fatal(err)
			}
			// Unknown fields remain barriers even before the typed contract grows.
			preserved["future_boundary"] = json.RawMessage("true")
			changed, err := json.Marshal(preserved)
			if err != nil {
				t.Fatal(err)
			}
			if child {
				envelope.SubagentCurrent = &current
			} else {
				envelope.Current = &current
			}
			before := compareFlowerLiveEncodedCurrent(envelope, encoded)
			after := compareFlowerLiveEncodedCurrent(envelope, changed)
			if before.fingerprint == after.fingerprint {
				t.Fatal("unknown envelope field was dropped from comparison")
			}
		})
	}
}
