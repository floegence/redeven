package ai

import (
	"fmt"
	"runtime"
	"strings"
	"testing"

	"github.com/floegence/floret/v7/observation"
	flruntime "github.com/floegence/floret/v7/runtime"
	"github.com/floegence/floret/v7/tools"
)

func flowerLiveEncodingBenchmarkCurrent(items int) flruntime.ThreadView {
	current := thinkingCurrent(1, "Streaming answer", true, flruntime.ThreadActivityActive)
	current.Items = nil
	for index := range items {
		current.Items = append(current.Items, flruntime.ThreadItem{
			ID: fmt.Sprintf("activity-%d", index), TurnID: current.TurnID, RunID: current.RunID,
			Ordinal: uint64(index + 1), Kind: flruntime.ThreadItemTool,
			Activity: &observation.ActivityItem{
				ItemID: fmt.Sprintf("activity-%d", index),
				Kind:   observation.ActivityKindTool, Status: observation.ActivityStatusSuccess,
				ToolName: "inspect", Presentation: &tools.ActivityPresentation{Label: "Inspect", Renderer: tools.ActivityRendererTerminal, Payload: tools.TerminalActivityPayload{Operation: "exec", Command: "inspect", Output: strings.Repeat("Completed inspection. ", 100), Status: "success"}},
			},
		})
	}
	current.Items = append(current.Items, flruntime.ThreadItem{
		ID: "answer", TurnID: current.TurnID, RunID: current.RunID, Ordinal: uint64(items + 1),
		Kind: flruntime.ThreadItemAssistant, Text: "Streaming answer", Live: true,
	})
	return current
}

func BenchmarkFlowerLiveCurrentEncoding(b *testing.B) {
	for _, count := range []int{20, 200} {
		b.Run(fmt.Sprintf("activity_items_%d", count), func(b *testing.B) {
			current := flowerLiveEncodingBenchmarkCurrent(count)
			envelope := FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion,
				Kind: FlowerLiveStreamThreadBatch, ThreadID: current.ThreadID.String(), Current: &current}
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				batch := newFlowerLiveEncodedBatch(envelope)
				if batch.err != nil {
					b.Fatal(batch.err)
				}
				if len(batch.data) == 0 {
					b.Fatal("missing encoded current")
				}
			}
		})
	}
}

// The live append path has no history argument or historical projection. These
// histories stay resident to detect accidental dependency and allocation growth.
func BenchmarkFlowerLiveNativeAppend(b *testing.B) {
	for _, count := range []int{200, 2000} {
		b.Run(fmt.Sprintf("history_items_%d", count), func(b *testing.B) {
			history := flowerLiveEncodingBenchmarkCurrent(count)
			update := flruntime.ThreadUpdate{ThreadID: history.ThreadID, TurnID: history.TurnID, RunID: history.RunID, BaseVersion: 1, ViewVersion: 2,
				Items: []flruntime.ThreadItemChange{{Kind: flruntime.ThreadItemAppended, ItemID: "answer", Append: &flruntime.ThreadTextAppend{OffsetBytes: 16, Text: " next output"}}}}
			b.ReportAllocs()
			b.ResetTimer()
			for b.Loop() {
				batch := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: update.ThreadID.String(), Update: &update})
				if batch.err != nil {
					b.Fatal(batch.err)
				}
				if len(batch.data) > 1024 {
					b.Fatalf("append unexpectedly carries history: %d bytes", len(batch.data))
				}
			}
			runtime.KeepAlive(history)
		})
	}
}

func TestFlowerLiveNativeAppendTransferBudget(t *testing.T) {
	var appendBytes int
	for _, count := range []int{200, 2000} {
		current := flowerLiveEncodingBenchmarkCurrent(count)
		full := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: current.ThreadID.String(), Current: &current})
		update := flruntime.ThreadUpdate{ThreadID: current.ThreadID, TurnID: current.TurnID, RunID: current.RunID, BaseVersion: 1, ViewVersion: 2,
			Items: []flruntime.ThreadItemChange{{Kind: flruntime.ThreadItemAppended, ItemID: "answer", Append: &flruntime.ThreadTextAppend{OffsetBytes: 16, Text: " next output"}}}}
		delta := newFlowerLiveEncodedBatch(FlowerLiveStreamEnvelope{SchemaVersion: FlowerLiveSchemaVersion, Kind: FlowerLiveStreamThreadBatch, ThreadID: current.ThreadID.String(), Update: &update})
		if full.err != nil || delta.err != nil {
			t.Fatalf("encoding failed: full=%v append=%v", full.err, delta.err)
		}
		if len(delta.data)*10 > len(full.data) || len(delta.data) > 1024 {
			t.Fatalf("append transfer budget exceeded: history=%d full=%d append=%d", count, len(full.data), len(delta.data))
		}
		if appendBytes != 0 && len(delta.data) != appendBytes {
			t.Fatalf("append transfer depends on history: %d != %d", len(delta.data), appendBytes)
		}
		appendBytes = len(delta.data)
		t.Logf("history_items=%d snapshot_bytes=%d append_bytes=%d reduction=%.4f%%", count, len(full.data), appendBytes, 100*(1-float64(appendBytes)/float64(len(full.data))))
	}
}
