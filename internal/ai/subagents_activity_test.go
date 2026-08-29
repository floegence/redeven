package ai

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/floegence/floret/v5/identity"
	"github.com/floegence/floret/v5/observation"
	flruntime "github.com/floegence/floret/v5/runtime"
	fltools "github.com/floegence/floret/v5/tools"
	aitools "github.com/floegence/redeven/internal/ai/tools"
)

func TestFloretSubagentCallActivityPreservesWaitTargets(t *testing.T) {
	t.Parallel()

	presentation := toolStartActivityPresentation("subagents", map[string]any{
		"action": "wait",
		"ids":    []any{"thread-big-tech", "thread-models", "thread-policy"},
	})
	if presentation == nil || presentation.Renderer != fltools.ActivityRendererSubAgentOperation {
		t.Fatalf("presentation = %#v", presentation)
	}
	payload, ok := presentation.Payload.(fltools.SubAgentOperationActivityPayload)
	if !ok || payload.Action != fltools.SubAgentOperationWait || payload.Status != toolCallStatusRunning || payload.RequestedCount != 3 || len(payload.Targets) != 3 {
		t.Fatalf("payload = %#v", presentation.Payload)
	}
	got := []identity.ThreadID{payload.Targets[0].ThreadID, payload.Targets[1].ThreadID, payload.Targets[2].ThreadID}
	want := []identity.ThreadID{"thread-big-tech", "thread-models", "thread-policy"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("target order = %#v, want %#v", got, want)
	}
}

func TestFloretSubagentResultActivityPreservesEveryTargetAndOutcome(t *testing.T) {
	t.Parallel()

	presentation, err := floretActivityForToolResult(nil, ToolResult{
		ToolID: "tool-wait", ToolName: "subagents", Status: toolResultStatusSuccess,
		Data: map[string]any{
			"action":        "wait",
			"ids":           []any{"thread-big-tech", "thread-models", "thread-policy"},
			"missing_count": 1,
			"timed_out":     true,
			"counts":        map[string]any{"completed": 2, "total": 2},
			"items": []any{
				map[string]any{"thread_id": "thread-models", "task_name": "AI Models and Products", "status": "completed"},
				map[string]any{"thread_id": "thread-big-tech", "task_name": "Big Tech AI News", "status": "completed"},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if presentation == nil || presentation.Renderer != fltools.ActivityRendererSubAgentOperation {
		t.Fatalf("presentation = %#v", presentation)
	}
	payload, ok := presentation.Payload.(fltools.SubAgentOperationActivityPayload)
	if !ok || payload.Action != fltools.SubAgentOperationWait || payload.Status != toolResultStatusSuccess || payload.RequestedCount != 3 || payload.CompletedCount != 2 || payload.MissingCount != 1 || !payload.TimedOut || len(payload.Targets) != 3 {
		t.Fatalf("payload = %#v", presentation.Payload)
	}
	if payload.Targets[0].TaskName != "Big Tech AI News" || payload.Targets[1].TaskName != "AI Models and Products" || payload.Targets[2].ThreadID != "thread-policy" {
		t.Fatalf("ordered targets = %#v", payload.Targets)
	}
}

func TestFloretSubagentFailureActivityPreservesCallActionAndTargets(t *testing.T) {
	t.Parallel()

	presentation, err := floretActivityForToolResult(nil, ToolResult{
		ToolID: "tool-wait", ToolName: "subagents", Status: toolResultStatusError,
		Error: &aitools.ToolError{Code: aitools.ErrorCodeUnknown, Message: "wait failed"},
		activityInput: map[string]any{
			"action": "wait",
			"ids":    []any{"thread-big-tech", "thread-models", "thread-policy"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, ok := presentation.Payload.(fltools.SubAgentOperationActivityPayload)
	if !ok || payload.Action != fltools.SubAgentOperationWait || payload.Status != toolResultStatusError || payload.RequestedCount != 3 || len(payload.Targets) != 3 {
		t.Fatalf("payload = %#v", presentation.Payload)
	}
	if payload.Error == nil || payload.Error.Message != "wait failed" {
		t.Fatalf("error = %#v", payload.Error)
	}
}

func TestSelectSubagentSnapshotsPreservesRequestedOrder(t *testing.T) {
	t.Parallel()

	items := []subagentSnapshot{
		{ThreadID: "thread-policy", TaskName: "Policy"},
		{ThreadID: "thread-big-tech", TaskName: "Big Tech"},
		{ThreadID: "thread-models", TaskName: "Models"},
	}
	selected := selectSubagentSnapshots(items, []string{"thread-big-tech", "thread-models", "thread-policy"})
	got := []string{selected[0].ThreadID, selected[1].ThreadID, selected[2].ThreadID}
	want := []string{"thread-big-tech", "thread-models", "thread-policy"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("selected order = %#v, want %#v", got, want)
	}
}

func TestTypedThreadItemPreservesSubagentOperationAfterJSONReload(t *testing.T) {
	t.Parallel()

	presentation, err := floretActivityForToolResult(nil, ToolResult{
		ToolID: "tool-wait", ToolName: "subagents", Status: toolResultStatusSuccess,
		Data: map[string]any{
			"action":          "wait",
			"ids":             []any{"thread-big-tech", "thread-models", "thread-policy"},
			"requested_count": 3,
			"completed_count": 3,
			"items": []any{
				map[string]any{"thread_id": "thread-policy", "task_name": "AI Policy and Business", "status": "completed"},
				map[string]any{"thread_id": "thread-big-tech", "task_name": "Big Tech AI News", "status": "completed"},
				map[string]any{"thread_id": "thread-models", "task_name": "AI Models and Products", "status": "completed"},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	original := flruntime.ThreadItem{
		ID: "tool:wait", TurnID: "turn:wait", Ordinal: 1, Kind: flruntime.ThreadItemTool,
		CreatedAt: time.UnixMilli(1_700_000_000_000),
		Activity: &observation.ActivityItem{
			ItemID: "tool-wait", ToolID: "tool-wait", ToolName: "subagents",
			Kind: observation.ActivityKindTool, Status: observation.ActivityStatusSuccess,
			Severity: observation.ActivitySeverityNormal, Presentation: presentation,
		},
	}
	persisted, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	var reloaded flruntime.ThreadItem
	if err := json.Unmarshal(persisted, &reloaded); err != nil {
		t.Fatal(err)
	}
	messageJSON, ok, err := typedThreadItemMessage("thread-parent", reloaded)
	if err != nil || !ok {
		t.Fatalf("project reloaded item: ok=%v err=%v", ok, err)
	}
	var message struct {
		Blocks []struct {
			Items []struct {
				Presentation struct {
					Renderer string `json:"renderer"`
					Payload  struct {
						Action         string `json:"action"`
						RequestedCount int    `json:"requested_count"`
						Targets        []struct {
							ThreadID string `json:"thread_id"`
							TaskName string `json:"task_name"`
						} `json:"targets"`
					} `json:"payload"`
				} `json:"presentation"`
			} `json:"items"`
		} `json:"blocks"`
	}
	if err := json.Unmarshal(messageJSON, &message); err != nil {
		t.Fatal(err)
	}
	projected := message.Blocks[0].Items[0].Presentation
	if projected.Renderer != string(fltools.ActivityRendererSubAgentOperation) || projected.Payload.Action != "wait" || projected.Payload.RequestedCount != 3 {
		t.Fatalf("projected operation = %#v in %s", projected, messageJSON)
	}
	got := make([]string, 0, len(projected.Payload.Targets))
	for _, target := range projected.Payload.Targets {
		got = append(got, target.ThreadID+":"+target.TaskName)
	}
	want := []string{
		"thread-big-tech:Big Tech AI News",
		"thread-models:AI Models and Products",
		"thread-policy:AI Policy and Business",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("projected targets = %#v, want %#v", got, want)
	}
}
