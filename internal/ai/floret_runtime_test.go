package ai

import (
	"strings"
	"testing"

	"github.com/floegence/floret/observation"
	flruntime "github.com/floegence/floret/runtime"
	"github.com/floegence/redeven/internal/config"
)

func TestFloretEventSinkDoesNotProjectSanitizedProviderText(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 2)
	r := &run{
		messageID:                 "msg_floret_event",
		onStreamEvent:             func(ev any) { events = append(events, ev) },
		currentTextBlockIndex:     -1,
		currentThinkingBlockIndex: -1,
		needNewTextBlock:          true,
		needNewThinkingBlock:      true,
	}
	sink := floretEventSink{run: r}
	sink.EmitEvent(flruntime.Event{Type: "provider_delta", Message: "text"})
	sink.EmitEvent(flruntime.Event{Type: "provider_reasoning", Message: "thinking"})

	if len(r.assistantBlocks) != 0 || len(events) != 0 {
		t.Fatalf("provider event sink wrote assistant output: blocks=%#v events=%#v", r.assistantBlocks, events)
	}
}

func TestProjectFloretTaskCompleteDoesNotDuplicateProjectedControlActivity(t *testing.T) {
	t.Parallel()

	events := make([]any, 0, 4)
	r := newRun(runOptions{})
	r.id = "run_floret_task_complete"
	r.threadID = "thread_floret_task_complete"
	r.messageID = "msg_floret_task_complete"
	r.onStreamEvent = func(ev any) { events = append(events, ev) }
	r.recordObservationActivityEvent(observation.Event{
		Type:     observation.EventTypeControlSignal,
		ToolID:   "call_task_complete",
		ToolName: "task_complete",
		ToolKind: "control",
		Activity: &observation.ActivityPresentation{
			Label:    "task_complete",
			Renderer: observation.ActivityRendererCompletion,
			Payload:  map[string]any{"result": "Done."},
		},
	})

	err := r.projectFloretResult(
		t.Context(),
		flruntime.ProjectedTurnResult{
			Status: flruntime.TurnStatusCompleted,
			Metrics: flruntime.RunMetrics{
				Steps: 1,
			},
			Signal: &flruntime.TurnSignal{
				Name:       "task_complete",
				CallID:     "call_task_complete",
				Payload:    map[string]any{"result": "Done."},
				OutputText: "Done.",
			},
		},
		RunRequest{},
		newRuntimeState(""),
		TaskComplexityStandard,
		config.AIModeAct,
	)
	if err != nil {
		t.Fatalf("projectFloretResult: %v", err)
	}

	var blockSets []streamEventBlockSet
	for _, ev := range events {
		if bs, ok := ev.(streamEventBlockSet); ok {
			blockSets = append(blockSets, bs)
		}
	}
	if len(blockSets) != 1 {
		t.Fatalf("block-set events=%d, want only the original activity update: %#v", len(blockSets), blockSets)
	}
	if blockSets[0].BlockIndex != 0 {
		t.Fatalf("activity block-set index=%d, want 0", blockSets[0].BlockIndex)
	}
	if len(r.assistantBlocks) != 2 {
		t.Fatalf("assistantBlocks len=%d, want 2: %#v", len(r.assistantBlocks), r.assistantBlocks)
	}
	if _, ok := r.assistantBlocks[0].(ActivityTimelineBlock); !ok {
		t.Fatalf("block[0]=%T, want activity timeline", r.assistantBlocks[0])
	}
	text, ok := r.assistantBlocks[1].(*persistedMarkdownBlock)
	if !ok || text.Content != "Done." {
		t.Fatalf("block[1]=%T %+v, want final markdown", r.assistantBlocks[1], r.assistantBlocks[1])
	}
}

func TestFlowerMessagesToFloretRejectsUnsupportedRole(t *testing.T) {
	t.Parallel()

	_, err := flowerMessagesToFloret([]Message{{Role: "developer"}})
	if err == nil || !strings.Contains(err.Error(), "unsupported role") {
		t.Fatalf("error=%v, want unsupported role rejection", err)
	}
}
