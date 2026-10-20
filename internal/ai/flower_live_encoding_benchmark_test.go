package ai

import (
	"fmt"
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
				if batch.current == nil || len(batch.data) == 0 {
					b.Fatal("missing encoded current")
				}
			}
		})
	}
}
